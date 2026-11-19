package store

import (
	"context"
	"time"
)

// PushSub is one browser's push subscription (see the Push API): where to send and the
// keys to encrypt for it.
type PushSub struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// SavePushSub stores a browser's subscription for the user, taking it over if another
// account had it on this browser.
func (s *Store) SavePushSub(ctx context.Context, userID int64, sub PushSub) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)
ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
		sub.Endpoint, userID, sub.P256dh, sub.Auth, time.Now().UnixMilli())
	return err
}

// DeletePushSub forgets a subscription: turned off, or the push service says it is gone.
// userID 0 deletes it whoever owns it.
func (s *Store) DeletePushSub(ctx context.Context, userID int64, endpoint string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = ? AND (? = 0 OR user_id = ?)`, endpoint, userID, userID)
	return err
}

// PushSubs lists the user's subscriptions, or everyone's when userID is 0.
func (s *Store) PushSubs(ctx context.Context, userID int64) ([]PushSub, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE ? = 0 OR user_id = ?`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSub
	for rows.Next() {
		var p PushSub
		if err := rows.Scan(&p.Endpoint, &p.P256dh, &p.Auth); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Announce records dances whose video is on the site and returns those not seen before,
// each exactly once even with two servers running during a release. The first call ever
// only records what is there, so turning this on doesn't announce the whole programme.
func (s *Store) Announce(ctx context.Context, slugs []string) ([]string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var seen int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM announced`).Scan(&seen); err != nil {
		return nil, err
	}
	var fresh []string
	now := time.Now().UnixMilli()
	for _, slug := range slugs {
		r, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO announced(dance, at) VALUES (?,?)`, slug, now)
		if err != nil {
			return nil, err
		}
		if n, _ := r.RowsAffected(); n == 1 && seen > 0 {
			fresh = append(fresh, slug)
		}
	}
	return fresh, tx.Commit()
}
