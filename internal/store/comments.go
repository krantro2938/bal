package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type Comment struct {
	ID        int64   `json:"id"`
	Dance     string  `json:"dance"`
	ParentID  int64   `json:"parentId,omitempty"`
	Author    Author  `json:"author"`
	Body      string  `json:"body"`
	Status    string  `json:"status"`
	Score     float64 `json:"-"`
	Pinned    bool    `json:"pinned,omitempty"`
	CreatedAt int64   `json:"createdAt"`
	Likes     int     `json:"likes"`
	Liked     bool    `json:"liked,omitempty"`
}

type Author struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Picture  string `json:"picture,omitempty"`
}

const commentCols = `c.id, c.dance, COALESCE(c.parent_id, 0), u.id, u.name, u.username, u.picture, c.body, c.status, c.score, c.pinned, c.created_at,
  (SELECT count(*) FROM comment_likes l WHERE l.comment_id = c.id),
  EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?)`

func scanComment(row interface{ Scan(...any) error }) (Comment, error) {
	var c Comment
	err := row.Scan(&c.ID, &c.Dance, &c.ParentID, &c.Author.ID, &c.Author.Name, &c.Author.Username, &c.Author.Picture, &c.Body, &c.Status,
		&c.Score, &c.Pinned, &c.CreatedAt, &c.Likes, &c.Liked)
	return c, err
}

// Comments lists a dance's comments that viewerID may see: published ones, the viewer's
// own held ones, and every held one for moderators. viewerID 0 is a guest.
func (s *Store) Comments(ctx context.Context, dance string, viewerID int64, moderator bool) ([]Comment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+commentCols+` FROM comments c JOIN users u ON u.id = c.user_id
WHERE c.dance = ? AND (c.status = 'published' OR c.user_id = ? OR ?)
ORDER BY c.created_at LIMIT 5000`, viewerID, dance, viewerID, moderator)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Comment returns one comment as seen by viewerID (for Liked).
func (s *Store) Comment(ctx context.Context, id, viewerID int64) (Comment, error) {
	c, err := scanComment(s.db.QueryRowContext(ctx, `SELECT `+commentCols+` FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`, viewerID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func (s *Store) CreateComment(ctx context.Context, userID int64, c Comment) (Comment, error) {
	var parent any
	if c.ParentID != 0 {
		parent = c.ParentID
	}
	var id int64
	err := s.db.QueryRowContext(ctx, `INSERT INTO comments(dance, user_id, parent_id, body, status, score, created_at)
VALUES (?,?,?,?,?,?,?) RETURNING id`, c.Dance, userID, parent, c.Body, c.Status, c.Score, time.Now().UnixMilli()).Scan(&id)
	if err != nil {
		return c, err
	}
	return s.Comment(ctx, id, userID)
}

// DeleteComment removes a comment with its replies, likes and reports.
func (s *Store) DeleteComment(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM comments WHERE id = ?`, id)
	return err
}

// LikeComment sets or clears the user's like and returns the new count.
func (s *Store) LikeComment(ctx context.Context, userID, id int64, on bool) (int, error) {
	q := `DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?`
	if on {
		q = `INSERT OR IGNORE INTO comment_likes(comment_id, user_id) VALUES (?,?)`
	}
	if _, err := s.db.ExecContext(ctx, q, id, userID); err != nil {
		return 0, err
	}
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM comment_likes WHERE comment_id = ?`, id).Scan(&n)
	return n, err
}

// ReportComment records one report per user and returns how many the comment has.
func (s *Store) ReportComment(ctx context.Context, userID, id int64) (int, error) {
	if _, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO comment_reports(comment_id, user_id, created_at) VALUES (?,?,?)`,
		id, userID, time.Now().UnixMilli()); err != nil {
		return 0, err
	}
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM comment_reports WHERE comment_id = ?`, id).Scan(&n)
	return n, err
}

// SetCommentStatus publishes or holds a comment; approving clears its reports.
func (s *Store) SetCommentStatus(ctx context.Context, id int64, status string) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE comments SET status = ? WHERE id = ?`, status, id); err != nil {
		return err
	}
	if status == "published" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM comment_reports WHERE comment_id = ?`, id)
		return err
	}
	return nil
}

// PinComment pins one top-level comment per dance (unpinning any other), or unpins it.
func (s *Store) PinComment(ctx context.Context, dance string, id int64, on bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE comments SET pinned = 0 WHERE dance = ? AND pinned = 1`, dance); err != nil {
		return err
	}
	if on {
		if _, err := tx.ExecContext(ctx, `UPDATE comments SET pinned = 1 WHERE id = ? AND parent_id IS NULL`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type Notification struct {
	ID        int64   `json:"id"`
	Kind      string  `json:"kind"` // "reply" or "mention"
	CreatedAt int64   `json:"createdAt"`
	Read      bool    `json:"read"`
	Comment   Comment `json:"comment"`
}

// Notify records one notification per user and comment (a reply that also mentions
// you counts once). It reports whether a new one was added.
func (s *Store) Notify(ctx context.Context, userID int64, kind string, commentID int64) (bool, error) {
	res, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO notifications(user_id, kind, comment_id, created_at) VALUES (?,?,?,?)`,
		userID, kind, commentID, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// Notifications returns the user's latest notifications for published comments and the unread count.
func (s *Store) Notifications(ctx context.Context, userID int64) ([]Notification, int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT n.id, n.kind, n.created_at, n.read_at IS NOT NULL, `+commentCols+`
FROM notifications n JOIN comments c ON c.id = n.comment_id JOIN users u ON u.id = c.user_id
WHERE n.user_id = ? AND c.status = 'published' ORDER BY n.created_at DESC LIMIT 50`, userID, userID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Notification{}
	unread := 0
	for rows.Next() {
		var n Notification
		c := &n.Comment
		if err := rows.Scan(&n.ID, &n.Kind, &n.CreatedAt, &n.Read, &c.ID, &c.Dance, &c.ParentID, &c.Author.ID, &c.Author.Name,
			&c.Author.Username, &c.Author.Picture, &c.Body, &c.Status, &c.Score, &c.Pinned, &c.CreatedAt, &c.Likes, &c.Liked); err != nil {
			return nil, 0, err
		}
		if !n.Read {
			unread++
		}
		out = append(out, n)
	}
	return out, unread, rows.Err()
}

func (s *Store) MarkNotificationsRead(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, time.Now().UnixMilli(), userID)
	return err
}
