package server

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"bal/internal/auth"
	"bal/internal/store"
)

// handleRegister creates an email+password account and signs it in at once:
// there is no confirmation email, so people get to their notes quickly. The
// address counts as unverified until Google proves it (see ClaimVerifiedEmail).
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(s.clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Слишком много попыток, подождите минуту"})
		return
	}
	var in struct{ Name, Email, Password string }
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Email = store.NormalizeEmail(in.Email)
	switch {
	case in.Name == "" || utf8.RuneCountInString(in.Name) > 80:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Укажите имя", "field": "name"})
		return
	case !auth.ValidEmail(in.Email):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Проверьте адрес почты", "field": "email"})
		return
	case !auth.ValidPassword(in.Password):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Пароль — от 8 символов", "field": "password"})
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		httpError(w, err)
		return
	}
	u, err := s.store.CreateUser(r.Context(), store.NewUser{Name: in.Name, Email: in.Email, PasswordHash: hash})
	if errors.Is(err, store.ErrEmailTaken) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Этот адрес уже зарегистрирован — войдите", "field": "email"})
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	if err := s.startSession(w, r, u.ID); err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": u})
}

func (s *Server) handlePasswordLogin(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(s.clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Слишком много попыток, подождите минуту"})
		return
	}
	var in struct{ Email, Password string }
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	u, err := s.store.UserByEmail(r.Context(), in.Email)
	hash := ""
	if err == nil {
		hash = u.PasswordHash
	} else if !errors.Is(err, store.ErrNotFound) {
		httpError(w, err)
		return
	}
	// Always one bcrypt comparison, so timing does not reveal registered emails.
	if !auth.CheckPassword(hash, in.Password) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Неверная почта или пароль"})
		return
	}
	if err := s.startSession(w, r, u.ID); err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

// clientIP is the peer address, or the proxy-reported one when the server
// sits behind a trusted reverse proxy (BAL_TRUST_PROXY=1).
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// limiter allows `burst` attempts per key and refills one every `every`.
type limiter struct {
	mu     sync.Mutex
	burst  float64
	every  time.Duration
	tokens map[string]float64
	seen   map[string]time.Time
}

func newLimiter(burst int, every time.Duration) *limiter {
	return &limiter{burst: float64(burst), every: every, tokens: map[string]float64{}, seen: map[string]time.Time{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	t, ok := l.tokens[key]
	if !ok {
		t = l.burst
	} else {
		t = min(l.burst, t+float64(now.Sub(l.seen[key]))/float64(l.every))
	}
	l.seen[key] = now
	if len(l.tokens) > 10000 { // drop state rather than grow without bound
		clear(l.tokens)
		clear(l.seen)
	}
	if t < 1 {
		l.tokens[key] = t
		return false
	}
	l.tokens[key] = t - 1
	return true
}
