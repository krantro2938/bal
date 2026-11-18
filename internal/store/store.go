// Package store keeps users, sessions and private rehearsal data in SQLite.
// Every query that touches personal data is scoped by user_id.
package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.ensureUsernames(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

type Note struct {
	ID        int64   `json:"id"`
	Dance     string  `json:"dance"`
	Version   string  `json:"version"`
	T         float64 `json:"t"`
	Text      string  `json:"text"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt int64   `json:"updatedAt"`
}

func (s *Store) Notes(ctx context.Context, userID int64, dance string) ([]Note, error) {
	q := `SELECT id, dance, version, t, text, created_at, updated_at FROM notes WHERE user_id = ?`
	args := []any{userID}
	if dance != "" {
		q += ` AND dance = ?`
		args = append(args, dance)
	}
	q += ` ORDER BY dance, t`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Note{}
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.ID, &n.Dance, &n.Version, &n.T, &n.Text, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) CreateNote(ctx context.Context, userID int64, n Note) (*Note, error) {
	now := time.Now().UnixMilli()
	n.CreatedAt, n.UpdatedAt = now, now
	err := s.db.QueryRowContext(ctx, `INSERT INTO notes(user_id, dance, version, t, text, created_at, updated_at)
VALUES (?,?,?,?,?,?,?) RETURNING id`, userID, n.Dance, n.Version, n.T, n.Text, now, now).Scan(&n.ID)
	return &n, err
}

// UpdateNote changes text and/or time of a note owned by userID.
func (s *Store) UpdateNote(ctx context.Context, userID, id int64, text *string, t *float64) (*Note, error) {
	n := &Note{}
	err := s.db.QueryRowContext(ctx, `
UPDATE notes SET text = COALESCE(?, text), t = COALESCE(?, t), updated_at = ?
WHERE id = ? AND user_id = ?
RETURNING id, dance, version, t, text, created_at, updated_at`, text, t, time.Now().UnixMilli(), id, userID).
		Scan(&n.ID, &n.Dance, &n.Version, &n.T, &n.Text, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return n, err
}

func (s *Store) DeleteNote(ctx context.Context, userID, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM notes WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetMark(ctx context.Context, userID int64, dance, kind string, on bool) error {
	var err error
	if on {
		_, err = s.db.ExecContext(ctx, `INSERT OR IGNORE INTO marks(user_id, dance, kind, created_at) VALUES (?,?,?,?)`,
			userID, dance, kind, time.Now().UnixMilli())
	} else {
		_, err = s.db.ExecContext(ctx, `DELETE FROM marks WHERE user_id = ? AND dance = ? AND kind = ?`, userID, dance, kind)
	}
	return err
}

type Progress struct {
	Dance     string  `json:"dance"`
	Version   string  `json:"version"`
	Position  float64 `json:"position"`
	UpdatedAt int64   `json:"updatedAt"`
}

func (s *Store) SetProgress(ctx context.Context, userID int64, p Progress) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO progress(user_id, dance, version, position, updated_at) VALUES (?,?,?,?,?)
ON CONFLICT(user_id, dance) DO UPDATE SET version=excluded.version, position=excluded.position, updated_at=excluded.updated_at`,
		userID, p.Dance, p.Version, p.Position, time.Now().UnixMilli())
	return err
}

type State struct {
	Favorites []string   `json:"favorites"`
	Learned   []string   `json:"learned"`
	Progress  []Progress `json:"progress"`
	Notes     []Note     `json:"notes"`
}

func (s *Store) State(ctx context.Context, userID int64) (*State, error) {
	st := &State{Favorites: []string{}, Learned: []string{}, Progress: []Progress{}}
	rows, err := s.db.QueryContext(ctx, `SELECT dance, kind FROM marks WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var dance, kind string
		if err := rows.Scan(&dance, &kind); err != nil {
			rows.Close()
			return nil, err
		}
		if kind == "favorite" {
			st.Favorites = append(st.Favorites, dance)
		} else {
			st.Learned = append(st.Learned, dance)
		}
	}
	rows.Close()
	rows, err = s.db.QueryContext(ctx, `SELECT dance, version, position, updated_at FROM progress WHERE user_id = ? ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p Progress
		if err := rows.Scan(&p.Dance, &p.Version, &p.Position, &p.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		st.Progress = append(st.Progress, p)
	}
	rows.Close()
	if st.Notes, err = s.Notes(ctx, userID, ""); err != nil {
		return nil, err
	}
	return st, nil
}
