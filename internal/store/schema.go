package store

import (
	"context"
	"fmt"
)

// migrations run in order; PRAGMA user_version records how many have run.
var migrations = []string{
	// 1: first release.
	`CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  name        TEXT NOT NULL,
  username    TEXT NOT NULL DEFAULT '',
  picture     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  UNIQUE(provider, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dance       TEXT NOT NULL,
  version     TEXT NOT NULL,
  t           REAL NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_user_dance ON notes(user_id, dance, t);
CREATE TABLE IF NOT EXISTS marks (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dance       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('favorite','learned')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, dance, kind)
);
CREATE TABLE IF NOT EXISTS progress (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dance       TEXT NOT NULL,
  version     TEXT NOT NULL,
  position    REAL NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, dance)
);`,

	// 2: one user can sign in several ways (Telegram, Google, email+password),
	// so sign-in identities move to user_accounts and users gain email/password.
	`CREATE TABLE users_v2 (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  username        TEXT NOT NULL DEFAULT '',
  picture         TEXT NOT NULL DEFAULT '',
  email           TEXT,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  password_hash   TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL
);
INSERT INTO users_v2(id, name, username, picture, created_at) SELECT id, name, username, picture, created_at FROM users;
CREATE TABLE user_accounts (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
INSERT INTO user_accounts(provider, subject, user_id, created_at) SELECT provider, subject, id, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX user_accounts_user ON user_accounts(user_id);`,

	// 3: public like/dislike per dance (one reaction per user).
	`CREATE TABLE reactions (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dance       TEXT NOT NULL,
  value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, dance)
);
CREATE INDEX reactions_dance ON reactions(dance);`,

	// 4: views, at most one per visitor per dance per day. visitor is a user id
	// or a salted hash of IP and browser, never the raw address.
	`CREATE TABLE views (
  dance    TEXT NOT NULL,
  visitor  TEXT NOT NULL,
  day      TEXT NOT NULL,
  PRIMARY KEY (dance, visitor, day)
) WITHOUT ROWID;`,

	// 5: public comments under each dance, one level of replies. status is
	// 'published' or 'held' (waiting for a moderator; seen by its author and moderators).
	`CREATE TABLE comments (
  id          INTEGER PRIMARY KEY,
  dance       TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('published','held')),
  score       REAL NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX comments_dance ON comments(dance, created_at);
CREATE INDEX comments_parent ON comments(parent_id);
CREATE TABLE comment_likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
) WITHOUT ROWID;
CREATE TABLE comment_reports (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
) WITHOUT ROWID;`,

	// 6: notifications: someone replied to your comment or mentioned your @username.
	`CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('reply','mention')),
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER,
  UNIQUE (user_id, comment_id)
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);`,

	// 7: a deleted comment that has replies stays as a placeholder («Комментарий удалён»)
	// so its thread keeps its shape; its text is wiped.
	`ALTER TABLE comments ADD COLUMN deleted_at INTEGER;`,
}

// migrate applies pending migrations on one connection with foreign keys
// off, so rebuilding the users table cannot cascade into notes.
func (s *Store) migrate() error {
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var version int
	if err := conn.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	// Databases from the first release predate user_version but have the tables.
	if version == 0 {
		var n int
		conn.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users'`).Scan(&n)
		if n == 1 {
			version = 1
		}
	}
	if version >= len(migrations) {
		return nil
	}
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`)
	for i := version; i < len(migrations); i++ {
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	var bad int
	if err := conn.QueryRowContext(ctx, `SELECT count(*) FROM pragma_foreign_key_check`).Scan(&bad); err != nil {
		return err
	}
	if bad > 0 {
		return fmt.Errorf("migration left %d dangling foreign keys", bad)
	}
	return nil
}
