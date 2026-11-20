package server

import (
	"bufio"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"image"
	"image/jpeg"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"bal/internal/auth"
	"bal/internal/content"
	"bal/internal/moderation"
	"bal/internal/store"
)

var lastServer *Server

// newTestServer serves one prepared dance ("demo", version v1, 100 s).
func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	dir := t.TempDir()
	src := content.Sources{Dances: []content.Source{{Slug: "demo", Title: "Демо", Kind: "dance", Order: 1}}}
	srcPath := filepath.Join(dir, "sources.json")
	if err := src.Save(srcPath); err != nil {
		t.Fatal(err)
	}
	media := filepath.Join(dir, "media")
	os.MkdirAll(filepath.Join(media, "demo"), 0o755)
	meta := content.Meta{Slug: "demo", Version: "v1", Video: content.VideoMeta{Path: "demo/video-v1.mp4", Duration: 100}}
	b, _ := json.Marshal(meta)
	os.WriteFile(filepath.Join(media, "demo", "meta.json"), b, 0o644)
	os.WriteFile(filepath.Join(media, "demo", "video-v1.mp4"), make([]byte, 4096), 0o644)

	st, err := store.Open(filepath.Join(dir, "db", "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	s := &Server{
		cfg:    Config{DevLogin: true, MediaDir: media, StaticDir: t.TempDir(), PublicURL: "http://example.test", Log: log.Default()},
		store:  st,
		lib:    &content.Library{SourcesPath: srcPath, MediaDir: media},
		secret: []byte("test-secret-test-secret-test-sec"),
	}
	s.providers = map[string]*auth.Provider{}
	s.limiter = newLimiter(1000, time.Millisecond)
	s.comments = newLimiter(1000, time.Millisecond)
	s.checker = &moderation.Checker{}
	s.events = newHub()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if s.push, err = newPusher(key, "http://example.test"); err != nil {
		t.Fatal(err)
	}
	lastServer = s
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)
	return ts
}

func TestSharePage(t *testing.T) {
	ts := newTestServer(t)
	s := lastServer
	s.cfg.ShareURL = "https://share.example.test"
	poster := filepath.Join(s.cfg.MediaDir, "demo", "poster.jpg")
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 800, 450)), nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(poster, jpegData.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	check := func(path string, expected ...string) {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, ts.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-Bal-Share", "1")
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("share page returned %s with content type %q", resp.Status, resp.Header.Get("Content-Type"))
		}
		for _, value := range expected {
			if !strings.Contains(string(body), value) {
				t.Errorf("share page %s missing %q", path, value)
			}
		}
		if strings.Contains(string(body), "<script") {
			t.Errorf("share page %s loads a script", path)
		}
	}

	check("/",
		`property="og:site_name" content="Звёздная одиссея"`,
		`property="og:title" content="Репетиции бала"`,
		`name="twitter:title" content="Репетиции бала"`,
		`property="og:image" content="https://share.example.test/og.png"`,
		`property="og:image:width" content="1200"`,
		`property="og:image:height" content="630"`,
		`name="twitter:card" content="summary_large_image"`,
		`name="twitter:image" content="https://share.example.test/og.png"`)
	check("/dance/demo?t=42&v=2",
		`property="og:title" content="Демо"`,
		`property="og:image" content="https://share.example.test/media/demo/poster.jpg"`,
		`property="og:image:width" content="800"`,
		`property="og:image:height" content="450"`,
		`name="twitter:image" content="https://share.example.test/media/demo/poster.jpg"`,
		`property="og:url" content="https://share.example.test/dance/demo?t=42&amp;v=2"`,
		`href="http://example.test/dance/demo?t=42&amp;v=2"`)
	if err := os.Remove(poster); err != nil {
		t.Fatal(err)
	}
	check("/dance/demo", `property="og:image" content="https://share.example.test/og.png"`)
}

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newClient(t *testing.T, ts *httptest.Server) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: ts.URL, http: &http.Client{Jar: jar, Timeout: 5 * time.Second}}
}

func (c *client) do(method, path, body string) (int, string) {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.base+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	var sb strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		sb.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return resp.StatusCode, sb.String()
}

func TestNotesArePrivate(t *testing.T) {
	ts := newTestServer(t)
	anna, boris, guest := newClient(t, ts), newClient(t, ts), newClient(t, ts)
	if code, _ := anna.do("POST", "/api/auth/dev", `{"name":"Анна"}`); code != 200 {
		t.Fatalf("login anna: %d", code)
	}
	if code, _ := boris.do("POST", "/api/auth/dev", `{"name":"Борис"}`); code != 200 {
		t.Fatalf("login boris: %d", code)
	}

	code, body := anna.do("POST", "/api/notes", `{"dance":"demo","version":"v1","t":42.34,"text":"поворот"}`)
	if code != 201 {
		t.Fatalf("create: %d %s", code, body)
	}
	var n store.Note
	json.Unmarshal([]byte(body), &n)
	if n.T != 42.3 || n.Version != "v1" {
		t.Fatalf("stored note %+v", n)
	}
	id := "/api/notes/" + jsonNum(n.ID)

	if _, body := boris.do("GET", "/api/notes?dance=demo", ""); strings.TrimSpace(body) != "[]" {
		t.Fatalf("boris sees notes: %s", body)
	}
	if code, _ := boris.do("PATCH", id, `{"text":"чужое"}`); code != 404 {
		t.Fatalf("boris patch: %d", code)
	}
	if code, _ := boris.do("DELETE", id, ""); code != 404 {
		t.Fatalf("boris delete: %d", code)
	}
	if code, _ := guest.do("GET", "/api/notes?dance=demo", ""); code != 401 {
		t.Fatalf("guest list: %d", code)
	}
	if _, body := anna.do("GET", "/api/me/state", ""); !strings.Contains(body, "поворот") {
		t.Fatalf("anna lost her note: %s", body)
	}
	if code, _ := anna.do("DELETE", id, ""); code != 204 {
		t.Fatalf("anna delete: %d", code)
	}
}

func TestNoteValidation(t *testing.T) {
	ts := newTestServer(t)
	c := newClient(t, ts)
	c.do("POST", "/api/auth/dev", `{"name":"Анна"}`)
	for _, body := range []string{
		`{"dance":"demo","version":"old","t":1,"text":"x"}`,  // stale version
		`{"dance":"demo","version":"v1","t":500,"text":"x"}`, // beyond video
		`{"dance":"nope","version":"v1","t":1,"text":"x"}`,   // unknown dance
		`{"dance":"demo","version":"v1","t":1,"text":"  "}`,  // empty
	} {
		if code, _ := c.do("POST", "/api/notes", body); code != 400 {
			t.Errorf("%s: got %d, want 400", body, code)
		}
	}
}

func TestCrossOriginMutationRefused(t *testing.T) {
	ts := newTestServer(t)
	req, _ := http.NewRequest("POST", ts.URL+"/api/auth/dev", strings.NewReader(`{"name":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("got %d, want 403", resp.StatusCode)
	}
}

func TestMediaRangeAndPrivacy(t *testing.T) {
	ts := newTestServer(t)
	req, _ := http.NewRequest("GET", ts.URL+"/media/demo/video-v1.mp4", nil)
	req.Header.Set("Range", "bytes=1000-1999")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 206 || resp.Header.Get("Content-Range") != "bytes 1000-1999/4096" {
		t.Fatalf("range: %d %q", resp.StatusCode, resp.Header.Get("Content-Range"))
	}
	for _, p := range []string{"/media/demo/meta.json", "/media/demo/", "/media/%2e%2e/db/t.db", "/media/demo/..%2f..%2fdb/t.db"} {
		resp, _ := http.Get(ts.URL + p)
		resp.Body.Close()
		if resp.StatusCode != 404 && resp.StatusCode != 400 {
			t.Errorf("%s: got %d", p, resp.StatusCode)
		}
	}
}

func TestSafeReturn(t *testing.T) {
	for in, want := range map[string]string{
		"/dance/demo?t=42": "/dance/demo?t=42",
		"//evil.example":   "/me",
		"https://evil":     "/me",
		"/\\evil":          "/me",
		"":                 "/me",
	} {
		if got := safeReturn(in); got != want {
			t.Errorf("safeReturn(%q) = %q, want %q", in, got, want)
		}
	}
}

func jsonNum(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestRegisterAndLogin(t *testing.T) {
	ts := newTestServer(t)
	c := newClient(t, ts)
	if code, body := c.do("POST", "/api/auth/register", `{"name":"Анна","email":"Anna@Example.com","password":"short"}`); code != 400 {
		t.Fatalf("weak password: %d %s", code, body)
	}
	if code, body := c.do("POST", "/api/auth/register", `{"name":"Анна","email":"Anna@Example.com","password":"вальс-гавот"}`); code != 201 {
		t.Fatalf("register: %d %s", code, body)
	}
	// Signed in straight away, no email confirmation.
	if _, body := c.do("GET", "/api/me", ""); !strings.Contains(body, "anna@example.com") {
		t.Fatalf("me after register: %s", body)
	}
	if code, _ := c.do("POST", "/api/auth/register", `{"name":"Другая","email":"anna@example.com","password":"12345678"}`); code != 409 {
		t.Fatalf("duplicate register: %d", code)
	}
	other := newClient(t, ts)
	if code, _ := other.do("POST", "/api/auth/login", `{"email":"anna@example.com","password":"wrong-password"}`); code != 401 {
		t.Fatalf("wrong password: %d", code)
	}
	if code, _ := other.do("POST", "/api/auth/login", `{"email":"nobody@example.com","password":"whatever1"}`); code != 401 {
		t.Fatalf("unknown email: %d", code)
	}
	if code, _ := other.do("POST", "/api/auth/login", `{"email":" ANNA@example.com","password":"вальс-гавот"}`); code != 200 {
		t.Fatalf("login: %d", code)
	}
}

func TestReactionAPI(t *testing.T) {
	ts := newTestServer(t)
	guest, anna := newClient(t, ts), newClient(t, ts)
	if code, _ := guest.do("PUT", "/api/dances/demo/reaction", `{"value":1}`); code != 401 {
		t.Fatalf("guest reaction: %d", code)
	}
	anna.do("POST", "/api/auth/dev", `{"name":"Анна"}`)
	if code, body := anna.do("PUT", "/api/dances/demo/reaction", `{"value":1}`); code != 200 || !strings.Contains(body, `"likes":1`) {
		t.Fatalf("like: %d %s", code, body)
	}
	if _, body := guest.do("GET", "/api/catalog", ""); !strings.Contains(body, `"likes":1`) || !strings.Contains(body, `"myReaction":0`) {
		t.Fatalf("catalog counts for guest: %s", body)
	}
	if code, _ := anna.do("PUT", "/api/dances/nope/reaction", `{"value":1}`); code != 404 {
		t.Fatalf("unknown dance: %d", code)
	}
}

func TestLiveViewsDedupePerVisitor(t *testing.T) {
	ts := newTestServer(t)
	a, b := newClient(t, ts), newClient(t, ts)
	stream, err := a.http.Get(ts.URL + "/api/dances/demo/events")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	lines := bufio.NewScanner(stream.Body)
	wantViews := func(want int) {
		t.Helper()
		for lines.Scan() {
			payload, ok := strings.CutPrefix(lines.Text(), "data: ")
			if !ok {
				continue
			}
			var e event
			if err := json.Unmarshal([]byte(payload), &e); err != nil || e.Type != "views" || e.Views == nil || *e.Views != want {
				t.Fatalf("want views event %d, got %s (%v)", want, payload, err)
			}
			return
		}
		t.Fatalf("missing views event %d: %v", want, lines.Err())
	}
	wantViews(0)
	a.do("POST", "/api/dances/demo/view", "")
	wantViews(1)
	a.do("POST", "/api/dances/demo/view", "") // same guest, same half-hour slot
	b.do("POST", "/api/auth/dev", `{"name":"Анна"}`)
	b.do("POST", "/api/dances/demo/view", "")
	wantViews(2)
	if _, body := a.do("GET", "/api/catalog", ""); !strings.Contains(body, `"views":2`) {
		t.Fatalf("views: %s", body)
	}
	if code, _ := a.do("POST", "/api/dances/nope/view", ""); code != 404 {
		t.Fatalf("unknown dance: %d", code)
	}
}
