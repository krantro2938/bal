package server

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"bal/internal/auth"
	"bal/internal/store"
)

var errLog = log.Default()

func logErr(err error) { errLog.Printf("error: %v", err) }

const oauthCookie = "bal_oauth"

type pendingLogin struct {
	State    string `json:"s"`
	Verifier string `json:"v"`
	Nonce    string `json:"n"`
	Return   string `json:"r"`
	Exp      int64  `json:"e"`
}

func randomString(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// safeReturn only allows same-site relative paths as post-login targets.
func safeReturn(p string) string {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/\\") {
		return "/me"
	}
	return p
}

func (s *Server) sign(b []byte) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *Server) unsign(v string) ([]byte, bool) {
	payload, sig, ok := strings.Cut(v, ".")
	if !ok {
		return nil, false
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	m := hmac.New(sha256.New, s.secret)
	m.Write(b)
	want := base64.RawURLEncoding.EncodeToString(m.Sum(nil))
	return b, hmac.Equal([]byte(sig), []byte(want))
}

func (s *Server) provider(w http.ResponseWriter, r *http.Request) *auth.Provider {
	p := s.providers[r.PathValue("provider")]
	if p == nil {
		http.Redirect(w, r, s.frontend("/login?error=unavailable"), http.StatusSeeOther)
	}
	return p
}

func (s *Server) handleOAuthStart(w http.ResponseWriter, r *http.Request) {
	prov := s.provider(w, r)
	if prov == nil {
		return
	}
	p := pendingLogin{State: randomString(18), Verifier: randomString(48), Nonce: randomString(18),
		Return: safeReturn(r.URL.Query().Get("return")), Exp: time.Now().Add(10 * time.Minute).Unix()}
	b, _ := json.Marshal(p)
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Value: s.sign(b), Path: "/auth/" + prov.Name + "/",
		MaxAge: 600, HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, prov.AuthURL(p.State, p.Verifier, p.Nonce), http.StatusFound)
}

func (s *Server) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	prov := s.provider(w, r)
	if prov == nil {
		return
	}
	fail := func(reason string) {
		http.Redirect(w, r, s.frontend("/login?error="+reason), http.StatusSeeOther)
	}
	c, err := r.Cookie(oauthCookie)
	if err != nil {
		fail("expired")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Value: "", Path: "/auth/" + prov.Name + "/", MaxAge: -1})
	raw, ok := s.unsign(c.Value)
	var p pendingLogin
	if !ok || json.Unmarshal(raw, &p) != nil || time.Now().Unix() > p.Exp {
		fail("expired")
		return
	}
	q := r.URL.Query()
	if q.Get("error") != "" {
		fail("denied")
		return
	}
	if !hmac.Equal([]byte(q.Get("state")), []byte(p.State)) || q.Get("code") == "" {
		fail("state")
		return
	}
	claims, err := prov.Exchange(r.Context(), q.Get("code"), p.Verifier, p.Nonce)
	if err != nil {
		logErr(err)
		fail(prov.Name)
		return
	}
	u, err := s.userForClaims(r.Context(), prov.Name, claims)
	if err != nil {
		logErr(err)
		fail("server")
		return
	}
	if err := s.startSession(w, r, u.ID); err != nil {
		logErr(err)
		fail("server")
		return
	}
	http.Redirect(w, r, s.frontend(p.Return), http.StatusSeeOther)
}

// frontend turns a same-site path into a URL on the page host (Vite in development).
func (s *Server) frontend(path string) string {
	if s.cfg.FrontendURL == "" {
		return path
	}
	return strings.TrimRight(s.cfg.FrontendURL, "/") + path
}

// userForClaims finds or creates the user behind a provider sign-in and links
// the provider account to them (the same rules as nim's Google sign-in):
//  1. a known provider account signs in its user;
//  2. otherwise a provider-verified email joins the account with that email,
//     which then counts as verified (dropping any unproven password);
//  3. otherwise a new user is created.
func (s *Server) userForClaims(ctx context.Context, provider string, c *auth.Claims) (*store.User, error) {
	if u, err := s.store.UserByAccount(ctx, provider, c.Sub); err == nil {
		s.store.RefreshProfile(ctx, u.ID, c.DisplayName(), c.Picture)
		return u, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	var u *store.User
	if c.VerifiedEmail() {
		existing, err := s.store.UserByEmail(ctx, c.Email)
		switch {
		case err == nil:
			if err := s.store.ClaimVerifiedEmail(ctx, existing.ID); err != nil {
				return nil, err
			}
			s.store.RefreshProfile(ctx, existing.ID, "", c.Picture)
			u = existing
		case !errors.Is(err, store.ErrNotFound):
			return nil, err
		}
	}
	if u == nil {
		email := ""
		if c.VerifiedEmail() {
			email = c.Email
		}
		created, err := s.store.CreateUser(ctx, store.NewUser{Name: c.DisplayName(), Username: c.PreferredUsername,
			Picture: c.Picture, Email: email, EmailVerified: email != ""})
		if err != nil {
			return nil, err
		}
		u = created
	}
	return u, s.store.LinkAccount(ctx, provider, c.Sub, u.ID)
}
