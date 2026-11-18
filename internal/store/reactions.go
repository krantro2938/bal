package store

import (
	"context"
	"time"
)

type Reactions struct {
	Likes    int `json:"likes"`
	Dislikes int `json:"dislikes"`
	Mine     int `json:"mine"` // 1, -1 or 0
}

// SetReaction stores a like (1), dislike (-1) or removes the reaction (0).
func (s *Store) SetReaction(ctx context.Context, userID int64, dance string, value int) error {
	if value == 0 {
		_, err := s.db.ExecContext(ctx, `DELETE FROM reactions WHERE user_id = ? AND dance = ?`, userID, dance)
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO reactions(user_id, dance, value, updated_at) VALUES (?,?,?,?)
ON CONFLICT(user_id, dance) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		userID, dance, value, time.Now().UnixMilli())
	return err
}

// ReactionCounts returns likes/dislikes for every dance that has any; userID 0
// means a guest (Mine stays 0).
func (s *Store) ReactionCounts(ctx context.Context, userID int64) (map[string]Reactions, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT dance,
  SUM(value = 1), SUM(value = -1), COALESCE(MAX(CASE WHEN user_id = ? THEN value END), 0)
FROM reactions GROUP BY dance`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Reactions{}
	for rows.Next() {
		var dance string
		var r Reactions
		if err := rows.Scan(&dance, &r.Likes, &r.Dislikes, &r.Mine); err != nil {
			return nil, err
		}
		out[dance] = r
	}
	return out, rows.Err()
}

// AddView records a view; repeats by the same visitor on the same day are ignored.
func (s *Store) AddView(ctx context.Context, dance, visitor string) error {
	_, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO views(dance, visitor, day) VALUES (?,?,?)`,
		dance, visitor, time.Now().UTC().Format("2006-01-02"))
	return err
}

func (s *Store) ViewCounts(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT dance, count(*) FROM views GROUP BY dance`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var d string
		var n int
		if err := rows.Scan(&d, &n); err != nil {
			return nil, err
		}
		out[d] = n
	}
	return out, rows.Err()
}
