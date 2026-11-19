// Package server is the HTTP service: JSON API, Telegram sign-in, the built
// frontend and Range-capable media files, all on one origin.
package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"bal/internal/auth"
	"bal/internal/content"
	"bal/internal/moderation"
	"bal/internal/store"
)

type Config struct {
	Addr        string
	DBPath      string
	StaticDir   string
	MediaDir    string
	SourcesPath string
	PublicURL   string
	FrontendURL string // defaults to PublicURL
	// ShareURL is a public host for links shared in messengers. Its proxy sets X-Bal-Share
	// on requests for share pages and sends browser navigations to PublicURL.
	ShareURL string

	GoogleClientID     string
	GoogleClientSecret string
	DevLogin           bool // local only: sign in with any name, no password
	TrustProxy         bool // take the client IP from X-Forwarded-For

	// ModerationURL is the toxicity-model sidecar (/moderation); empty means the word filter only.
	ModerationURL string
	// Moderators are emails (verified sign-ins only) that can approve, pin and delete comments.
	Moderators []string

	// AnalyticsURL is a self-hosted Umami origin and AnalyticsSiteID the website's UUID in it;
	// both empty means no counting (see analytics.go).
	AnalyticsURL    string
	AnalyticsSiteID string

	Log *log.Logger
}

type Server struct {
	cfg       Config
	store     *store.Store
	lib       *content.Library
	providers map[string]*auth.Provider
	limiter   *limiter
	secret    []byte
	comments  *limiter
	checker   *moderation.Checker
	events    *hub
	secure    bool
	// closing is closed when the server starts shutting down, so open event streams end and
	// the old process can exit while the new one takes the traffic.
	closing chan struct{}

	analyticsURL    string // Umami origin; empty while counting is off
	analyticsClient *http.Client
	publicHost      string
	pulses          *limiter
	pulseSlots      chan struct{}
}

const sessionCookie = "bal_session"

func Run(ctx context.Context, cfg Config) error {
	mime.AddExtensionType(".vtt", "text/vtt; charset=utf-8")
	mime.AddExtensionType(".webp", "image/webp")
	mime.AddExtensionType(".mp4", "video/mp4")
	mime.AddExtensionType(".webmanifest", "application/manifest+json")

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer st.Close()
	secret, err := loadSecret(filepath.Join(filepath.Dir(cfg.DBPath), "secret.key"))
	if err != nil {
		return err
	}
	pub, err := url.Parse(cfg.PublicURL)
	if err != nil {
		return err
	}
	s := &Server{
		cfg:    cfg,
		store:  st,
		lib:    &content.Library{SourcesPath: cfg.SourcesPath, MediaDir: cfg.MediaDir},
		secret: secret,
		secure: pub.Scheme == "https",

		closing:         make(chan struct{}),
		analyticsClient: newAnalyticsClient(),
		publicHost:      pub.Hostname(),
		pulses:          newLimiter(30, 2*time.Second),
		pulseSlots:      make(chan struct{}, 16),
	}
	if s.analyticsURL, err = analyticsOrigin(cfg.AnalyticsURL, cfg.AnalyticsSiteID); err != nil {
		cfg.Log.Printf("visit counting off: %v", err)
	} else if s.analyticsURL != "" {
		cfg.Log.Printf("visit counting: reports go to %s", s.analyticsURL)
	}
	s.providers = map[string]*auth.Provider{}
	s.limiter = newLimiter(10, 6*time.Second)
	s.comments = newLimiter(5, 30*time.Second)
	s.checker = &moderation.Checker{URL: strings.TrimRight(cfg.ModerationURL, "/"), Client: &http.Client{Timeout: 3 * time.Second}}
	s.events = newHub()
	if cfg.ModerationURL == "" {
		cfg.Log.Printf("comment moderation: word filter only (set BAL_MODERATION_URL for the toxicity model)")
	}
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" {
		s.providers["google"] = auth.Google(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.PublicURL)
	} else {
		cfg.Log.Printf("Google sign-in disabled: set BAL_GOOGLE_CLIENT_ID and BAL_GOOGLE_CLIENT_SECRET")
	}
	if cfg.DevLogin {
		cfg.Log.Printf("WARNING: BAL_DEV_LOGIN=1, anyone can sign in by name (local testing only)")
	}
	if _, _, err := s.lib.Snapshot(); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	srv.RegisterOnShutdown(func() { close(s.closing) })
	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return err
	}
	cfg.Log.Printf("listening on http://%s (public %s)", ln.Addr(), cfg.PublicURL)
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/catalog", s.handleCatalog)
	mux.HandleFunc("GET /api/dances/{slug}", s.handleDance)
	mux.HandleFunc("GET /api/auth/config", s.handleAuthConfig)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/auth/dev", s.handleDevLogin)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handlePasswordLogin)
	mux.HandleFunc("GET /auth/{provider}/start", s.handleOAuthStart)
	mux.HandleFunc("GET /auth/{provider}/callback", s.handleOAuthCallback)

	mux.Handle("GET /api/me/state", s.requireUser(s.handleState))
	mux.Handle("GET /api/notes", s.requireUser(s.handleListNotes))
	mux.Handle("POST /api/notes", s.requireUser(s.handleCreateNote))
	mux.Handle("PATCH /api/notes/{id}", s.requireUser(s.handleUpdateNote))
	mux.Handle("DELETE /api/notes/{id}", s.requireUser(s.handleDeleteNote))
	mux.Handle("PUT /api/marks/{kind}/{slug}", s.requireUser(s.handleMark(true)))
	mux.Handle("DELETE /api/marks/{kind}/{slug}", s.requireUser(s.handleMark(false)))
	mux.Handle("PUT /api/progress/{slug}", s.requireUser(s.handleProgress))
	mux.Handle("PUT /api/dances/{slug}/reaction", s.requireUser(s.handleReaction))
	mux.HandleFunc("POST /api/dances/{slug}/view", s.handleView)
	mux.HandleFunc("GET /api/dances/{slug}/comments", s.handleListComments)
	mux.HandleFunc("GET /api/dances/{slug}/events", s.handleEvents)
	mux.Handle("POST /api/dances/{slug}/comments", s.requireUser(s.handleCreateComment))
	mux.Handle("DELETE /api/comments/{id}", s.requireUser(s.handleDeleteComment))
	mux.Handle("PUT /api/comments/{id}/like", s.requireUser(s.handleLikeComment))
	mux.Handle("POST /api/comments/{id}/report", s.requireUser(s.handleReportComment))
	mux.Handle("POST /api/comments/{id}/approve", s.requireUser(s.handleApproveComment))
	mux.Handle("PUT /api/comments/{id}/pin", s.requireUser(s.handlePinComment))
	mux.Handle("GET /api/me/events", s.requireUser(s.handleMyEvents))
	mux.Handle("PATCH /api/me", s.requireUser(s.handleUpdateMe))
	mux.Handle("GET /api/me/username", s.requireUser(s.handleUsernameFree))
	mux.Handle("GET /api/notifications", s.requireUser(s.handleNotifications))
	mux.Handle("POST /api/notifications/read", s.requireUser(s.handleReadNotifications))

	mux.Handle("GET /media/", http.StripPrefix("/media/", mediaHandler(s.cfg.MediaDir)))
	mux.HandleFunc("POST /api/pulse", s.handlePulse)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /robots.txt", s.handleRobots)
	mux.HandleFunc("GET /sitemap.xml", s.handleSitemap)
	mux.Handle("GET /", s.spaHandler(s.cfg.StaticDir))
	return s.middleware(mux)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "+
			"style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; "+
			"frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		// Mutating requests must come from our own pages (cookies are SameSite=Lax too).
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if o := r.Header.Get("Origin"); o != "" && !s.sameOrigin(r, o) {
				http.Error(w, "cross-origin request refused", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) sameOrigin(r *http.Request, origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	for _, base := range []string{s.cfg.PublicURL, s.cfg.FrontendURL} {
		if pub, err := url.Parse(base); err == nil && base != "" && u.Host == pub.Host {
			return true
		}
	}
	return u.Host == r.Host
}

func loadSecret(path string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil && len(b) >= 64 {
		return hex.DecodeString(strings.TrimSpace(string(b)))
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	return key, os.WriteFile(path, []byte(hex.EncodeToString(key)), 0o600)
}
