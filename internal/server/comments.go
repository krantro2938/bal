package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	maxDepth      = 3 // replies to replies to replies; top-level comments are depth 0
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
	out := map[string]any{"comments": list, "moderator": s.isModerator(u)}
	if s.official != nil {
		out["pinnedBy"] = s.official.Username // pins are the site's, like a channel's on YouTube
	}
	writeJSON(w, http.StatusOK, out)
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
		if errors.Is(err, store.ErrNotFound) || (err == nil && (p.Dance != slug || p.Deleted || (p.Status != "published" && p.Author.ID != u.ID))) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Комментарий, на который вы отвечаете, удалён"})
			return
		} else if err != nil {
			httpError(w, err)
			return
		}
		// Replies nest like YouTube's, up to maxDepth; below that a reply joins its
		// parent's level (the box pre-fills an @mention so it still reads as an answer).
		depth, err := s.commentDepth(r.Context(), p)
		if err != nil {
			httpError(w, err)
			return
		}
		if depth >= maxDepth {
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
		s.notify(r.Context(), c)
	}
	out := map[string]any{"comment": c}
	if v.Status == moderation.Held {
		out["notice"] = v.Reason
	}
	writeJSON(w, http.StatusCreated, out)
}

// commentDepth counts c's ancestors (0 for a top-level comment).
func (s *Server) commentDepth(ctx context.Context, c store.Comment) (int, error) {
	depth := 0
	for c.ParentID != 0 && depth <= maxDepth {
		p, err := s.store.Comment(ctx, c.ParentID, 0)
		if err != nil {
			return 0, err
		}
		c = p
		depth++
	}
	return depth, nil
}

// commentFor loads the {id} comment for an action by u.
func (s *Server) commentFor(w http.ResponseWriter, r *http.Request, u *store.User) (store.Comment, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return store.Comment{}, false
	}
	c, err := s.store.Comment(r.Context(), id, u.ID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && (c.Deleted || c.Status != "published" && c.Author.ID != u.ID && !s.isModerator(u))) {
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
	soft, removed, err := s.store.DeleteComment(r.Context(), c.ID)
	if err != nil {
		httpError(w, err)
		return
	}
	if soft {
		// Kept as «Комментарий удалён» because it has replies.
		placeholder, err := s.store.Comment(r.Context(), c.ID, 0)
		if err != nil {
			httpError(w, err)
			return
		}
		s.events.publish(c.Dance, event{Type: "comment", Comment: &placeholder})
		writeJSON(w, http.StatusOK, map[string]any{"placeholder": placeholder})
		return
	}
	for _, id := range removed {
		s.events.publish(c.Dance, event{Type: "removed", ID: id})
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
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
	s.notify(r.Context(), c)
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
	Views   *int           `json:"views,omitempty"`
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

// handleEvents streams a dance page's comment events and view totals.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if ok, err := s.danceExists(slug); err != nil || !ok {
		http.NotFound(w, r)
		return
	}
	s.stream(w, r, slug, true)
}

// handleMyEvents streams the signed-in user's own events (new notifications).
func (s *Server) handleMyEvents(w http.ResponseWriter, r *http.Request, u *store.User) {
	s.stream(w, r, userChannel(u.ID), false)
}

func userChannel(id int64) string { return "user:" + strconv.FormatInt(id, 10) }

func (s *Server) stream(w http.ResponseWriter, r *http.Request, key string, withViews bool) {
	ch, done, ok := s.events.subscribe(key)
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
	if withViews {
		n, err := s.store.ViewCount(r.Context(), key)
		if err != nil {
			logErr(err)
		} else {
			fmt.Fprintf(w, "data: {\"type\":\"views\",\"views\":%d}\n\n", n)
		}
	}
	rc.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.closing:
			return // shutting down: the browser reconnects (retry above) to the new process
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

// --- mentions and notifications ---

var mentionRe = regexp.MustCompile(`(?i)(?:^|[^\p{L}\d_.@])@([a-z][a-z0-9_.]{2,29})`)

// mentions returns the distinct @handles in a comment, lower-cased.
func mentions(body string) []string {
	var out []string
	for _, m := range mentionRe.FindAllStringSubmatch(body, 20) {
		u := strings.TrimRight(strings.ToLower(m[1]), ".")
		if !slices.Contains(out, u) {
			out = append(out, u)
		}
	}
	return out
}

// notify tells the thread's author about a reply and everyone @mentioned, never the writer.
func (s *Server) notify(ctx context.Context, c store.Comment) {
	who := map[int64]string{}
	if c.ParentID != 0 {
		if p, err := s.store.Comment(ctx, c.ParentID, 0); err == nil {
			who[p.Author.ID] = "reply"
		}
	}
	if names := mentions(c.Body); len(names) > 0 {
		ids, err := s.store.UserIDsByUsername(ctx, names)
		if err != nil {
			logErr(err)
		}
		for _, id := range ids {
			if _, ok := who[id]; !ok {
				who[id] = "mention"
			}
		}
	}
	delete(who, c.Author.ID)
	for id, kind := range who {
		added, err := s.store.Notify(ctx, id, kind, c.ID)
		if err != nil {
			logErr(err)
			continue
		}
		if added {
			s.events.publish(userChannel(id), event{Type: "notification"})
			s.pushComment(id, kind, c)
		}
	}
}

type notificationDTO struct {
	store.Notification
	DanceTitle string `json:"danceTitle"`
}

func (s *Server) handleNotifications(w http.ResponseWriter, r *http.Request, u *store.User) {
	list, unread, err := s.store.Notifications(r.Context(), u.ID)
	if err != nil {
		httpError(w, err)
		return
	}
	src, _, err := s.lib.Snapshot()
	if err != nil {
		httpError(w, err)
		return
	}
	out := make([]notificationDTO, 0, len(list))
	for _, n := range list {
		d := notificationDTO{Notification: n}
		if dance := src.Find(n.Comment.Dance); dance != nil {
			d.DanceTitle = dance.Title
		}
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "unread": unread})
}

func (s *Server) handleReadNotifications(w http.ResponseWriter, r *http.Request, u *store.User) {
	if err := s.store.MarkNotificationsRead(r.Context(), u.ID); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleUpdateMe changes the user's @username.
func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request, u *store.User) {
	var in struct {
		Username string `json:"username"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Неверный запрос"})
		return
	}
	name := store.NormalizeUsername(in.Username)
	if !store.ValidUsername(name) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "3–30 символов: латинские буквы, цифры, «_» и «.», начинается с буквы", "field": "username"})
		return
	}
	if err := s.store.SetUsername(r.Context(), u.ID, name); errors.Is(err, store.ErrUsernameTaken) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Это имя уже занято", "field": "username"})
		return
	} else if err != nil {
		httpError(w, err)
		return
	}
	u.Username = name
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

// handleUsernameFree answers the live check in the username field.
func (s *Server) handleUsernameFree(w http.ResponseWriter, r *http.Request, u *store.User) {
	name := store.NormalizeUsername(r.URL.Query().Get("u"))
	free := false
	if store.ValidUsername(name) {
		var err error
		if free, err = s.store.UsernameFree(r.Context(), name, u.ID); err != nil {
			httpError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"valid": store.ValidUsername(name), "free": free})
}

type profileComment struct {
	store.Comment
	DanceTitle string `json:"danceTitle"`
}

// handleProfile is a user's public page: the account, its public counts and latest comments.
func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.ProfileByUsername(r.Context(), r.PathValue("username"))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Такого пользователя нет"})
		return
	} else if err != nil {
		httpError(w, err)
		return
	}
	var viewer int64
	if u := s.currentUser(r); u != nil {
		viewer = u.ID
	}
	list, err := s.store.UserComments(r.Context(), p.ID, viewer, 30)
	if err != nil {
		httpError(w, err)
		return
	}
	src, _, err := s.lib.Snapshot()
	if err != nil {
		httpError(w, err)
		return
	}
	out := make([]profileComment, 0, len(list))
	for _, c := range list {
		pc := profileComment{Comment: c}
		if d := src.Find(c.Dance); d != nil {
			pc.DanceTitle = d.Title
		}
		out = append(out, pc)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"profile": p, "comments": out})
}
