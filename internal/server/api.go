package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"bal/internal/content"
	"bal/internal/store"
)

type danceSummary struct {
	Slug        string       `json:"slug"`
	Order       int          `json:"order"`
	Title       string       `json:"title"`
	Kind        string       `json:"kind"`
	Description string       `json:"description"`
	Available   bool         `json:"available"`
	Duration    float64      `json:"duration,omitempty"`
	Poster      string       `json:"poster,omitempty"`
	PosterSmall string       `json:"posterSmall,omitempty"`
	HasScheme   bool         `json:"hasScheme"`
	HasAudio    bool         `json:"hasAudio"`
	Chapters    []chapterRef `json:"chapters,omitempty"` // for search and suggestions
	SourcePost  string       `json:"sourcePost"`
	Version     string       `json:"version,omitempty"`
	Preview     string       `json:"preview,omitempty"`
	Likes       int          `json:"likes"`
	Dislikes    int          `json:"dislikes"`
	MyReaction  int          `json:"myReaction"`
	Views       int          `json:"views"`
	Comments    int          `json:"comments"`
	Published   string       `json:"published,omitempty"`
}

type asset struct {
	Kind             string `json:"kind"`
	Post             string `json:"post"`
	Status           string `json:"status"`
	OriginalFilename string `json:"originalFilename"`
}

type danceDetail struct {
	danceSummary
	Caption     string               `json:"caption"`
	CaptionPost string               `json:"captionPost"`
	Video       *videoDTO            `json:"video,omitempty"`
	Thumbnails  string               `json:"thumbnails,omitempty"`
	Chapters    []content.Chapter    `json:"chapterList"`
	ChaptersSrc string               `json:"chaptersSource,omitempty"`
	Schemes     []content.SchemeMeta `json:"schemes"`
	Audio       []content.AudioMeta  `json:"audio"`
	Assets      []asset              `json:"assets"`
}

type videoDTO struct {
	URL    string  `json:"url"`
	Width  int     `json:"width"`
	Height int     `json:"height"`
	FPS    string  `json:"fps"`
	Bytes  int64   `json:"bytes"`
	Length float64 `json:"duration"`
}

type chapterRef struct {
	Title string  `json:"title"`
	Start float64 `json:"start"`
}

func mediaURL(p string) string { return "/media/" + p }

func summarize(d *content.Source, m *content.Meta) danceSummary {
	out := danceSummary{Slug: d.Slug, Order: d.Order, Title: d.Title, Kind: d.Kind,
		Description: d.Description, SourcePost: d.SourcePost, Published: d.Published}
	for _, a := range d.Assets {
		out.HasScheme = out.HasScheme || a.Kind == "scheme"
		out.HasAudio = out.HasAudio || a.Kind == "audio"
	}
	if d.Chapters != nil {
		for _, c := range d.Chapters.Items {
			out.Chapters = append(out.Chapters, chapterRef{c.Title, c.Start})
		}
	}
	if m != nil {
		out.Available = true
		out.Duration = m.Video.Duration
		out.Poster = mediaURL(m.Poster.Path)
		out.PosterSmall = mediaURL(m.Poster.Small)
		out.Version = m.Version
		if m.Preview != "" {
			out.Preview = mediaURL(m.Preview)
		}
	}
	return out
}

func (s *Server) reactions(r *http.Request) map[string]store.Reactions {
	var uid int64
	if u := s.currentUser(r); u != nil {
		uid = u.ID
	}
	counts, err := s.store.ReactionCounts(r.Context(), uid)
	if err != nil {
		logErr(err)
	}
	return counts
}

// tallies are the per-dance view and comment counts shown under each video.
type tallies struct{ views, comments map[string]int }

func (s *Server) tallies(r *http.Request) tallies {
	v, err := s.store.ViewCounts(r.Context())
	if err != nil {
		logErr(err)
	}
	c, err := s.store.CommentCounts(r.Context())
	if err != nil {
		logErr(err)
	}
	return tallies{v, c}
}

func withReactions(d *danceSummary, rx map[string]store.Reactions, t tallies) {
	c := rx[d.Slug]
	d.Likes, d.Dislikes, d.MyReaction = c.Likes, c.Dislikes, c.Mine
	d.Views = t.views[d.Slug]
	d.Comments = t.comments[d.Slug]
}

// handleView counts one view per visitor per dance per half hour (see store.AddView).
func (s *Server) handleView(w http.ResponseWriter, r *http.Request) {
	src, _, err := s.lib.Snapshot()
	if err != nil {
		httpError(w, err)
		return
	}
	slug := r.PathValue("slug")
	if src.Find(slug) == nil {
		http.NotFound(w, r)
		return
	}
	visitor := ""
	if u := s.currentUser(r); u != nil {
		visitor = fmt.Sprintf("u%d", u.ID)
	} else {
		m := hmac.New(sha256.New, s.secret)
		m.Write([]byte(s.clientIP(r) + "|" + r.UserAgent()))
		visitor = "g" + hex.EncodeToString(m.Sum(nil))[:24]
	}
	if err := s.store.AddView(r.Context(), slug, visitor); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	src, metas, err := s.lib.Snapshot()
	if err != nil {
		httpError(w, err)
		return
	}
	rx, t := s.reactions(r), s.tallies(r)
	out := make([]danceSummary, 0, len(src.Dances))
	for i := range src.Dances {
		d := &src.Dances[i]
		sum := summarize(d, metas[d.Slug])
		withReactions(&sum, rx, t)
		out = append(out, sum)
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, map[string]any{"edition": src.Edition, "channel": src.Channel, "shareUrl": s.cfg.ShareURL, "dances": out})
}

func (s *Server) handleDance(w http.ResponseWriter, r *http.Request) {
	src, metas, err := s.lib.Snapshot()
	if err != nil {
		httpError(w, err)
		return
	}
	d := src.Find(r.PathValue("slug"))
	if d == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Танец не найден"})
		return
	}
	m := metas[d.Slug]
	out := danceDetail{danceSummary: summarize(d, m), Caption: d.Caption, CaptionPost: d.CaptionPost,
		Schemes: []content.SchemeMeta{}, Audio: []content.AudioMeta{}, Chapters: []content.Chapter{}}
	withReactions(&out.danceSummary, s.reactions(r), s.tallies(r))
	for _, a := range d.Assets {
		out.Assets = append(out.Assets, asset{a.Kind, a.Post, a.Status, a.OriginalFilename})
	}
	if m != nil {
		out.Video = &videoDTO{URL: mediaURL(m.Video.Path), Width: m.Video.Width, Height: m.Video.Height,
			FPS: m.Video.FPS, Bytes: m.Video.Bytes, Length: m.Video.Duration}
		out.Thumbnails = mediaURL(m.Thumbnails)
		for _, sc := range m.Schemes {
			sc.Path, sc.Thumb = mediaURL(sc.Path), mediaURL(sc.Thumb)
			out.Schemes = append(out.Schemes, sc)
		}
		for _, a := range m.Audio {
			a.Path = mediaURL(a.Path)
			out.Audio = append(out.Audio, a)
		}
		if d.Chapters != nil {
			out.ChaptersSrc = d.Chapters.Source
			items := d.Chapters.Items
			for i, c := range items {
				end := m.Video.Duration
				if i+1 < len(items) {
					end = items[i+1].Start
				}
				out.Chapters = append(out.Chapters, content.Chapter{Start: c.Start, End: end, Title: c.Title})
			}
		}
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, out)
}

// --- auth ---

type ctxKey struct{}

func (s *Server) currentUser(r *http.Request) *store.User {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil
	}
	u, err := s.store.SessionUser(r.Context(), c.Value)
	if err != nil {
		return nil
	}
	return u
}

func (s *Server) requireUser(h func(http.ResponseWriter, *http.Request, *store.User)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := s.currentUser(r)
		if u == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Нужно войти"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)), u)
	})
}

func (s *Server) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{
		"google":   s.providers["google"] != nil,
		"password": true,
		"dev":      s.cfg.DevLogin,
		// Not about sign-in, but the page already asks for this once: whether to send /api/pulse.
		"analytics": s.analyticsURL != "",
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"user": s.currentUser(r)})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.store.DeleteSession(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true,
		Secure: s.secure, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDevLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DevLogin {
		http.NotFound(w, r)
		return
	}
	var in struct{ Name string }
	if err := decodeJSON(r, &in); err != nil || strings.TrimSpace(in.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Укажите имя"})
		return
	}
	name := strings.TrimSpace(in.Name)
	u, err := s.store.UserByAccount(r.Context(), "dev", strings.ToLower(name))
	if errors.Is(err, store.ErrNotFound) {
		if u, err = s.store.CreateUser(r.Context(), store.NewUser{Name: name}); err == nil {
			err = s.store.LinkAccount(r.Context(), "dev", strings.ToLower(name), u.ID)
		}
	}
	if err != nil {
		httpError(w, err)
		return
	}
	if err := s.startSession(w, r, u.ID); err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID int64) error {
	tok, exp, err := s.store.CreateSession(r.Context(), userID)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: tok, Path: "/", Expires: exp, HttpOnly: true,
		Secure: s.secure, SameSite: http.SameSiteLaxMode})
	return nil
}

// --- private data ---

func (s *Server) handleState(w http.ResponseWriter, r *http.Request, u *store.User) {
	st, err := s.store.State(r.Context(), u.ID)
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleListNotes(w http.ResponseWriter, r *http.Request, u *store.User) {
	notes, err := s.store.Notes(r.Context(), u.ID, r.URL.Query().Get("dance"))
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, notes)
}

const maxNote = 2000

// validMoment checks that slug names a prepared dance, version is its current
// tutorial version and t lies inside the video.
func (s *Server) validMoment(slug, version string, t float64) (string, bool) {
	_, metas, err := s.lib.Snapshot()
	if err != nil {
		return "Каталог недоступен", false
	}
	m := metas[slug]
	if m == nil {
		return "Видео этого танца ещё не загружено", false
	}
	if version != m.Version {
		return "Видео обновилось, обновите страницу", false
	}
	if math.IsNaN(t) || t < 0 || t > m.Video.Duration+1 {
		return "Время вне видео", false
	}
	return "", true
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request, u *store.User) {
	var in struct {
		Dance   string  `json:"dance"`
		Version string  `json:"version"`
		T       float64 `json:"t"`
		Text    string  `json:"text"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if in.Text == "" || utf8.RuneCountInString(in.Text) > maxNote {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Заметка пуста или длиннее 2000 символов"})
		return
	}
	if msg, ok := s.validMoment(in.Dance, in.Version, in.T); !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}
	n, err := s.store.CreateNote(r.Context(), u.ID, store.Note{Dance: in.Dance, Version: in.Version,
		T: math.Round(in.T*10) / 10, Text: in.Text})
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, n)
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request, u *store.User) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var in struct {
		Text *string  `json:"text"`
		T    *float64 `json:"t"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	if in.Text != nil {
		t := strings.TrimSpace(*in.Text)
		if t == "" || utf8.RuneCountInString(t) > maxNote {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Заметка пуста или длиннее 2000 символов"})
			return
		}
		in.Text = &t
	}
	if in.T != nil && (math.IsNaN(*in.T) || *in.T < 0) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Время вне видео"})
		return
	}
	n, err := s.store.UpdateNote(r.Context(), u.ID, id, in.Text, in.T)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Заметка не найдена"})
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, n)
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request, u *store.User) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	err = s.store.DeleteNote(r.Context(), u.ID, id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Заметка не найдена"})
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMark(on bool) func(http.ResponseWriter, *http.Request, *store.User) {
	return func(w http.ResponseWriter, r *http.Request, u *store.User) {
		kind := map[string]string{"favorite": "favorite", "learned": "learned"}[r.PathValue("kind")]
		src, _, err := s.lib.Snapshot()
		if err != nil {
			httpError(w, err)
			return
		}
		if kind == "" || src.Find(r.PathValue("slug")) == nil {
			http.NotFound(w, r)
			return
		}
		if err := s.store.SetMark(r.Context(), u.ID, r.PathValue("slug"), kind, on); err != nil {
			httpError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) handleProgress(w http.ResponseWriter, r *http.Request, u *store.User) {
	var in struct {
		Version  string  `json:"version"`
		Position float64 `json:"position"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	slug := r.PathValue("slug")
	if msg, ok := s.validMoment(slug, in.Version, in.Position); !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}
	if err := s.store.SetProgress(r.Context(), u.ID, store.Progress{Dance: slug, Version: in.Version,
		Position: math.Round(in.Position*10) / 10}); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleReaction(w http.ResponseWriter, r *http.Request, u *store.User) {
	var in struct {
		Value int `json:"value"`
	}
	if err := decodeJSON(r, &in); err != nil || in.Value < -1 || in.Value > 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	src, _, err := s.lib.Snapshot()
	if err != nil {
		httpError(w, err)
		return
	}
	slug := r.PathValue("slug")
	if src.Find(slug) == nil {
		http.NotFound(w, r)
		return
	}
	if err := s.store.SetReaction(r.Context(), u.ID, slug, in.Value); err != nil {
		httpError(w, err)
		return
	}
	counts, err := s.store.ReactionCounts(r.Context(), u.ID)
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, counts[slug])
}

// --- helpers ---

func decodeJSON(r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return errors.New("content-type must be application/json")
	}
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 16<<10))
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Ошибка сервера"})
	logErr(err)
}
