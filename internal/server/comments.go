package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"bal/internal/moderation"
	"bal/internal/store"
)

const (
	maxComment    = 2000
	hideAtReports = 3 // reports from different people that send a comment back to moderation
)

func (s *Server) isModerator(u *store.User) bool {
	if u == nil {
		return false
	}
	if s.cfg.DevLogin && slices.Contains(s.cfg.Moderators, strings.ToLower(u.Name)) {
		return true
	}
	return u.EmailVerified && u.Email != "" && slices.Contains(s.cfg.Moderators, strings.ToLower(u.Email))
}

func (s *Server) danceExists(slug string) (bool, error) {
	src, _, err := s.lib.Snapshot()
	if err != nil {
		return false, err
	}
	return src.Find(slug) != nil, nil
}

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if ok, err := s.danceExists(slug); err != nil {
		httpError(w, err)
		return
	} else if !ok {
		http.NotFound(w, r)
		return
	}
	u := s.currentUser(r)
	var uid int64
	if u != nil {
		uid = u.ID
	}
	list, err := s.store.Comments(r.Context(), slug, uid, s.isModerator(u))
	if err != nil {
		httpError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"comments": list, "moderator": s.isModerator(u)})
}

var blankLines = regexp.MustCompile(`\n{3,}`)

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request, u *store.User) {
	slug := r.PathValue("slug")
	if ok, err := s.danceExists(slug); err != nil {
		httpError(w, err)
		return
	} else if !ok {
		http.NotFound(w, r)
		return
	}
	var in struct {
		Body     string `json:"body"`
		ParentID int64  `json:"parentId"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	in.Body = blankLines.ReplaceAllString(strings.TrimSpace(strings.ReplaceAll(in.Body, "\r", "")), "\n\n")
	if in.Body == "" || utf8.RuneCountInString(in.Body) > maxComment {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Комментарий пуст или длиннее 2000 символов"})
		return
	}
	if !s.isModerator(u) && !s.comments.allow(strconv.FormatInt(u.ID, 10)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Слишком часто — подождите немного"})
		return
	}
	if in.ParentID != 0 {
		p, err := s.store.Comment(r.Context(), in.ParentID, u.ID)
		if errors.Is(err, store.ErrNotFound) || (err == nil && (p.Dance != slug || (p.Status != "published" && p.Author.ID != u.ID))) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Комментарий, на который вы отвечаете, удалён"})
			return
		} else if err != nil {
			httpError(w, err)
			return
		}
		// One level of replies, like YouTube: a reply to a reply joins the same thread.
		if p.ParentID != 0 {
			in.ParentID = p.ParentID
		}
	}
	v := s.checker.Check(r.Context(), in.Body)
	if v.Status == moderation.Rejected {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": v.Reason})
		return
	}
	c, err := s.store.CreateComment(r.Context(), u.ID, store.Comment{Dance: slug, ParentID: in.ParentID, Body: in.Body,
		Status: string(v.Status), Score: v.Score})
	if err != nil {
		httpError(w, err)
		return
	}
	if c.Status == "published" {
		s.events.publish(slug, event{Type: "comment", Comment: &c})
	}
	out := map[string]any{"comment": c}
	if v.Status == moderation.Held {
		out["notice"] = v.Reason
	}
	writeJSON(w, http.StatusCreated, out)
}

// commentFor loads the {id} comment for an action by u.
func (s *Server) commentFor(w http.ResponseWriter, r *http.Request, u *store.User) (store.Comment, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return store.Comment{}, false
	}
	c, err := s.store.Comment(r.Context(), id, u.ID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && c.Status != "published" && c.Author.ID != u.ID && !s.isModerator(u)) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Комментарий удалён"})
		return c, false
	} else if err != nil {
		httpError(w, err)
		return c, false
	}
	return c, true
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request, u *store.User) {
	c, ok := s.commentFor(w, r, u)
	if !ok {
		return
	}
	if c.Author.ID != u.ID && !s.isModerator(u) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Можно удалить только свой комментарий"})
		return
	}
	if err := s.store.DeleteComment(r.Context(), c.ID); err != nil {
		httpError(w, err)
		return
	}
	s.events.publish(c.Dance, event{Type: "removed", ID: c.ID})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLikeComment(w http.ResponseWriter, r *http.Request, u *store.User) {
	var in struct {
		On bool `json:"on"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	c, ok := s.commentFor(w, r, u)
	if !ok {
		return
	}
	n, err := s.store.LikeComment(r.Context(), u.ID, c.ID, in.On)
	if err != nil {
		httpError(w, err)
		return
	}
	if c.Status == "published" {
		s.events.publish(c.Dance, event{Type: "likes", ID: c.ID, Likes: n})
	}
	writeJSON(w, http.StatusOK, map[string]any{"likes": n, "liked": in.On})
}

func (s *Server) handleReportComment(w http.ResponseWriter, r *http.Request, u *store.User) {
	c, ok := s.commentFor(w, r, u)
	if !ok {
		return
	}
	if c.Author.ID == u.ID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Это ваш комментарий"})
		return
	}
	n, err := s.store.ReportComment(r.Context(), u.ID, c.ID)
	if err != nil {
		httpError(w, err)
		return
	}
	if n >= hideAtReports && c.Status == "published" {
		if err := s.store.SetCommentStatus(r.Context(), c.ID, "held"); err != nil {
			httpError(w, err)
			return
		}
		s.events.publish(c.Dance, event{Type: "removed", ID: c.ID})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleApproveComment(w http.ResponseWriter, r *http.Request, u *store.User) {
	if !s.isModerator(u) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Только для организаторов"})
		return
	}
	c, ok := s.commentFor(w, r, u)
	if !ok {
		return
	}
	if err := s.store.SetCommentStatus(r.Context(), c.ID, "published"); err != nil {
		httpError(w, err)
		return
	}
	c.Status, c.Liked = "published", false
	s.events.publish(c.Dance, event{Type: "comment", Comment: &c})
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handlePinComment(w http.ResponseWriter, r *http.Request, u *store.User) {
	if !s.isModerator(u) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Только для организаторов"})
		return
	}
	var in struct {
		On bool `json:"on"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	c, ok := s.commentFor(w, r, u)
	if !ok {
		return
	}
	if c.ParentID != 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Закрепить можно только комментарий, не ответ"})
		return
	}
	if err := s.store.PinComment(r.Context(), c.Dance, c.ID, in.On); err != nil {
		httpError(w, err)
		return
	}
	pinned := int64(0)
	if in.On {
		pinned = c.ID
	}
	s.events.publish(c.Dance, event{Type: "pinned", ID: pinned})
	w.WriteHeader(http.StatusNoContent)
}

// --- live updates ---

// event goes to everyone watching a dance page: a new or approved comment,
// a removed one, new like counts, or the pinned comment changing (ID 0: none).
type event struct {
	Type    string         `json:"type"`
	Comment *store.Comment `json:"comment,omitempty"`
	ID      int64          `json:"id,omitempty"`
	Likes   int            `json:"likes"`
}

const maxWatchers = 2000

type hub struct {
	mu   sync.Mutex
	n    int
	subs map[string]map[chan []byte]struct{}
}

func newHub() *hub { return &hub{subs: map[string]map[chan []byte]struct{}{}} }

func (h *hub) subscribe(slug string) (chan []byte, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.n >= maxWatchers {
		return nil, nil, false
	}
	ch := make(chan []byte, 16)
	if h.subs[slug] == nil {
		h.subs[slug] = map[chan []byte]struct{}{}
	}
	h.subs[slug][ch] = struct{}{}
	h.n++
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.subs[slug], ch)
		if len(h.subs[slug]) == 0 {
			delete(h.subs, slug)
		}
		h.n--
	}, true
}

func (h *hub) publish(slug string, e event) {
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[slug] {
		select {
		case ch <- b:
		default: // a stalled client misses this one; the list refetches on reconnect
		}
	}
}

// handleEvents streams a dance page's comment events (Server-Sent Events).
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if ok, err := s.danceExists(slug); err != nil || !ok {
		http.NotFound(w, r)
		return
	}
	ch, done, ok := s.events.subscribe(slug)
	if !ok {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many watchers", http.StatusServiceUnavailable)
		return
	}
	defer done()
	rc := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("retry: 5000\n\n"))
	rc.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case b := <-ch:
			w.Write([]byte("data: "))
			w.Write(b)
			w.Write([]byte("\n\n"))
		case <-ping.C:
			w.Write([]byte(": ping\n\n"))
		}
		if rc.Flush() != nil {
			return
		}
	}
}
