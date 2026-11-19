package store

import (
	"context"
	"database/sql"
	"errors"
)

// Profile is what anyone may see about a user: nothing private (no email, no watching
// history), only the account itself and what they posted publicly.
type Profile struct {
	Author
	CreatedAt   int64 `json:"createdAt"`             // ms
	Comments    int   `json:"comments"`              // published, not deleted
	Likes       int   `json:"likes"`                 // received on those comments
	LastComment int64 `json:"lastComment,omitempty"` // ms; their latest public activity
}

func (s *Store) ProfileByUsername(ctx context.Context, username string) (*Profile, error) {
	p := &Profile{}
	var last sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT u.id, u.name, u.username, u.picture, u.verified, u.created_at * 1000,
  (SELECT count(*) FROM comments c WHERE c.user_id = u.id AND c.status = 'published' AND c.deleted_at IS NULL),
  (SELECT count(*) FROM comment_likes l JOIN comments c ON c.id = l.comment_id
     WHERE c.user_id = u.id AND c.status = 'published' AND c.deleted_at IS NULL),
  (SELECT max(c.created_at) FROM comments c WHERE c.user_id = u.id AND c.status = 'published' AND c.deleted_at IS NULL)
FROM users u WHERE u.username = ?`, NormalizeUsername(username)).Scan(&p.ID, &p.Name, &p.Username, &p.Picture, &p.Verified,
		&p.CreatedAt, &p.Comments, &p.Likes, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	p.LastComment = last.Int64
	return p, err
}

// UserComments lists a user's published comments, newest first, as seen by viewerID.
func (s *Store) UserComments(ctx context.Context, userID, viewerID int64, limit int) ([]Comment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+commentCols+` FROM comments c JOIN users u ON u.id = c.user_id
WHERE c.user_id = ? AND c.status = 'published' AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT ?`, viewerID, userID, limit)
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
