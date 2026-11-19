package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// The site's own account: verified, and with no way to sign in (its sign-in
// identity is the "official" provider, which no login flow accepts).
const officialProvider, officialSubject = "official", "site"

// EnsureOfficial creates or refreshes the site's account and returns it as a comment author.
func (s *Store) EnsureOfficial(ctx context.Context, name, username, picture string) (Author, error) {
	u, err := s.UserByAccount(ctx, officialProvider, officialSubject)
	if errors.Is(err, ErrNotFound) {
		if u, err = s.CreateUser(ctx, NewUser{Name: name, Username: username, Picture: picture}); err != nil {
			return Author{}, err
		}
		err = s.LinkAccount(ctx, officialProvider, officialSubject, u.ID)
	}
	if err != nil {
		return Author{}, err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE users SET name = ?, picture = ?, verified = 1 WHERE id = ?`, name, picture, u.ID); err != nil {
		return Author{}, err
	}
	// The handle is set only if it is free; otherwise the account keeps the one it has.
	if u.Username != username {
		if free, err := s.UsernameFree(ctx, username, u.ID); err == nil && free && ValidUsername(username) {
			if err := s.SetUsername(ctx, u.ID, username); err == nil {
				u.Username = username
			}
		}
	}
	return Author{ID: u.ID, Name: name, Username: u.Username, Picture: picture, Verified: true}, nil
}

// UpsertOwnComment keeps one top-level comment by userID on a dance with the given text:
// an existing one gets the new text, otherwise a published one is created and pinned.
// It returns the comment and whether anything changed.
func (s *Store) UpsertOwnComment(ctx context.Context, userID int64, dance, body string) (Comment, bool, error) {
	var id int64
	var old string
	err := s.db.QueryRowContext(ctx, `SELECT id, body FROM comments
WHERE dance = ? AND user_id = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, dance, userID).Scan(&id, &old)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if err := s.db.QueryRowContext(ctx, `INSERT INTO comments(dance, user_id, body, status, created_at) VALUES (?,?,?,'published',?) RETURNING id`,
			dance, userID, body, time.Now().UnixMilli()).Scan(&id); err != nil {
			return Comment{}, false, err
		}
		if err := s.PinComment(ctx, dance, id, true); err != nil {
			return Comment{}, false, err
		}
	case err != nil:
		return Comment{}, false, err
	case old == body:
		c, err := s.Comment(ctx, id, 0)
		return c, false, err
	default:
		if _, err := s.db.ExecContext(ctx, `UPDATE comments SET body = ? WHERE id = ?`, body, id); err != nil {
			return Comment{}, false, err
		}
	}
	c, err := s.Comment(ctx, id, 0)
	return c, true, err
}
