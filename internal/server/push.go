package server

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"bal/internal/store"
)

// Push notifications (Web Push): a reply or mention reaches the phone while the site is
// closed, and so does a new dance video. Browsers hand us a subscription (an endpoint at
// their push service plus keys); we encrypt each message for it (RFC 8291) and sign the
// request with our VAPID key (RFC 8292). No third-party service or library.

// pushMessage is what the service worker shows (web/public/sw.js).
type pushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

type pushJob struct {
	userID int64 // 0: everyone who turned notifications on
	msg    pushMessage
}

type pusher struct {
	key     *ecdsa.PrivateKey
	public  string // uncompressed P-256 point, base64url: the applicationServerKey
	subject string // who we are, for the push services (our public URL)
	client  *http.Client
	jobs    chan pushJob
}

// loadVAPID reads the key from vapid.key next to the database, or makes one. Changing it
// would silently break every subscription, so it is kept like the session secret.
func loadVAPID(path string) (*ecdsa.PrivateKey, error) {
	if b, err := os.ReadFile(path); err == nil {
		raw, err := hex.DecodeString(strings.TrimSpace(string(b)))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		return ecdsa.ParseRawPrivateKey(elliptic.P256(), raw)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	raw, err := key.Bytes()
	if err != nil {
		return nil, err
	}
	return key, os.WriteFile(path, []byte(hex.EncodeToString(raw)), 0o600)
}

func newPusher(key *ecdsa.PrivateKey, subject string) (*pusher, error) {
	pub, err := key.PublicKey.Bytes()
	if err != nil {
		return nil, err
	}
	return &pusher{
		key:     key,
		public:  base64.RawURLEncoding.EncodeToString(pub),
		subject: subject,
		client:  &http.Client{Timeout: 15 * time.Second},
		jobs:    make(chan pushJob, 256),
	}, nil
}

// pushTo queues a message for the user's browsers (0: everyone's); it never blocks a request.
func (s *Server) pushTo(userID int64, msg pushMessage) {
	select {
	case s.push.jobs <- pushJob{userID, msg}:
	default:
		s.cfg.Log.Printf("push: queue full, dropped %q", msg.Tag)
	}
}

// runPush sends queued messages one browser at a time, and forgets subscriptions the push
// service says are gone (the app was uninstalled or notifications were turned off there).
func (s *Server) runPush(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-s.push.jobs:
			subs, err := s.store.PushSubs(ctx, job.userID)
			if err != nil {
				logErr(err)
				continue
			}
			payload, _ := json.Marshal(job.msg)
			for _, sub := range subs {
				gone, err := s.push.send(ctx, sub, payload)
				if gone {
					if err := s.store.DeletePushSub(ctx, 0, sub.Endpoint); err != nil {
						logErr(err)
					}
				} else if err != nil {
					s.cfg.Log.Printf("push: %v", err)
				}
			}
		}
	}
}

// send delivers one message; gone means the subscription no longer exists.
func (p *pusher) send(ctx context.Context, sub store.PushSub, payload []byte) (gone bool, err error) {
	body, err := encryptPush(sub, payload)
	if err != nil {
		return true, err // keys we can't use: the subscription is useless
	}
	auth, err := p.vapid(sub.Endpoint)
	if err != nil {
		return false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return true, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("TTL", "86400") // a phone that's off for a day still gets it
	req.Header.Set("Urgency", "normal")
	req.Header.Set("Authorization", auth)
	resp, err := p.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return true, nil
	case resp.StatusCode >= 300:
		return false, fmt.Errorf("%s: %s", hostOf(sub.Endpoint), resp.Status)
	}
	return false, nil
}

// vapid signs a short-lived ES256 token for the endpoint's push service.
func (p *pusher) vapid(endpoint string) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding
	header := enc.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{
		"aud": u.Scheme + "://" + u.Host,
		"exp": time.Now().Add(12 * time.Hour).Unix(),
		"sub": p.subject,
	})
	signing := header + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, p.key, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return "vapid t=" + signing + "." + enc.EncodeToString(sig) + ", k=" + p.public, nil
}

// encryptPush is RFC 8291 with the aes128gcm content coding (RFC 8188), in one record.
func encryptPush(sub store.PushSub, payload []byte) ([]byte, error) {
	uaPublic, err := decodeKey(sub.P256dh)
	if err != nil {
		return nil, err
	}
	authSecret, err := decodeKey(sub.Auth)
	if err != nil {
		return nil, err
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return encryptPushWith(uaPublic, authSecret, payload, as, salt)
}

// encryptPushWith takes our one-time key and the salt as arguments for the RFC's test vector.
func encryptPushWith(uaPublic, authSecret, payload []byte, as *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	ua, err := ecdh.P256().NewPublicKey(uaPublic)
	if err != nil {
		return nil, err
	}
	shared, err := as.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPublic := as.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), uaPublic...), asPublic...)
	ikm, err := hkdf.Key(sha256.New, shared, authSecret, string(info), 32)
	if err != nil {
		return nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	// Header: salt, record size, key id (our public key); then the one record, ended by 0x02.
	out := make([]byte, 0, 86+len(payload)+17)
	out = append(out, salt...)
	out = binary.BigEndian.AppendUint32(out, 4096)
	out = append(out, byte(len(asPublic)))
	out = append(out, asPublic...)
	return gcm.Seal(out, nonce, append(payload, 0x02), nil), nil
}

func decodeKey(s string) ([]byte, error) {
	s = strings.TrimRight(s, "=")
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(s)
}

// pushHosts are the browsers' push services. The server posts to whatever endpoint a
// browser hands it, so anything else is refused.
var pushHosts = []string{
	"fcm.googleapis.com",        // Chrome, Brave, Edge on Android, Yandex Browser
	"push.apple.com",            // Safari (web.push.apple.com)
	"push.services.mozilla.com", // Firefox
	"notify.windows.com",        // Edge on Windows
}

func validPushEndpoint(endpoint string) bool {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || len(endpoint) > 1024 {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range pushHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return true
		}
	}
	return false
}

func hostOf(endpoint string) string {
	if u, err := url.Parse(endpoint); err == nil {
		return u.Host
	}
	return "?"
}

// handlePushSubscribe stores this browser's subscription for the signed-in user.
func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request, u *store.User) {
	var in struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	pub, err1 := decodeKey(in.Keys.P256dh)
	secret, err2 := decodeKey(in.Keys.Auth)
	if !validPushEndpoint(in.Endpoint) || err1 != nil || err2 != nil || len(pub) != 65 || len(secret) != 16 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Этот браузер не поддерживается"})
		return
	}
	if err := s.store.SavePushSub(r.Context(), u.ID, store.PushSub{Endpoint: in.Endpoint, P256dh: in.Keys.P256dh, Auth: in.Keys.Auth}); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handlePushUnsubscribe forgets this browser's subscription (turned off, or signing out).
func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request, u *store.User) {
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	if err := s.store.DeletePushSub(r.Context(), u.ID, in.Endpoint); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pushComment tells someone about a reply or a mention, as the bell does.
func (s *Server) pushComment(userID int64, kind string, c store.Comment) {
	title := "Новый ответ"
	if kind == "mention" {
		title = "Вас упомянули"
	}
	if src, _, err := s.lib.Snapshot(); err == nil {
		if d := src.Find(c.Dance); d != nil {
			title += " · " + d.Title
		}
	}
	s.pushTo(userID, pushMessage{
		Title: title,
		Body:  c.Author.Name + ": " + clip(c.Body, 140),
		URL:   fmt.Sprintf("/dance/%s?c=%d", c.Dance, c.ID),
		Tag:   fmt.Sprintf("comment-%d", c.ID),
	})
}

// announceNew checks now and then for dances whose video has just appeared on the site
// and tells everyone with notifications on. The first check waits a little, so a release
// that fails its health check and is rolled back announces nothing.
func (s *Server) announceNew(ctx context.Context) {
	t := time.NewTimer(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		t.Reset(5 * time.Minute)
		src, metas, err := s.lib.Snapshot()
		if err != nil {
			logErr(err)
			continue
		}
		var ready []string
		for _, d := range src.Dances {
			if m := metas[d.Slug]; m != nil && m.Video.Path != "" {
				ready = append(ready, d.Slug)
			}
		}
		fresh, err := s.store.Announce(ctx, ready)
		if err != nil {
			logErr(err)
			continue
		}
		for _, slug := range fresh {
			d := src.Find(slug)
			if d == nil {
				continue
			}
			body := "Видео, схема и музыка уже на сайте"
			if d.Kind == "dance" {
				body = fmt.Sprintf("Танец %02d: видео, схема и музыка уже на сайте", d.Order)
			}
			s.cfg.Log.Printf("push: announcing %s", slug)
			s.pushTo(0, pushMessage{Title: "Новое видео: " + d.Title, Body: body, URL: "/dance/" + slug, Tag: "dance-" + slug})
		}
	}
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n])) + "…"
}
