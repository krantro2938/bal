package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

var ErrEmailTaken = errors.New("email already registered")

type User struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username,omitempty"`
	Picture  string `json:"picture,omitempty"`
	Email    string `json:"email,omitempty"`

	EmailVerified bool   `json:"-"`
	PasswordHash  string `json:"-"`
}

const userCols = `u.id, u.name, u.username, u.picture, COALESCE(u.email, ''), u.email_verified, u.password_hash`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	u := &User{}
	err := row.Scan(&u.ID, &u.Name, &u.Username, &u.Picture, &u.Email, &u.EmailVerified, &u.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

// NormalizeEmail lower-cases and trims an address; "" stays "".
func NormalizeEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func (s *Store) UserByAccount(ctx context.Context, provider, subject string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM user_accounts a JOIN users u ON u.id = a.user_id
WHERE a.provider = ? AND a.subject = ?`, provider, subject))
}

func (s *Store) UserByEmail(ctx context.Context, email string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users u WHERE u.email = ?`, NormalizeEmail(email)))
}

type NewUser struct {
	Name, Username, Picture string
	Email                   string // optional
	EmailVerified           bool
	PasswordHash            string
}

func (s *Store) CreateUser(ctx context.Context, n NewUser) (*User, error) {
	var email any
	if e := NormalizeEmail(n.Email); e != "" {
		email = e
	}
	// The provider's handle (Telegram) is kept when it is valid and free; otherwise one is made from the name.
	username := NormalizeUsername(n.Username)
	if free, err := s.UsernameFree(ctx, username, 0); err != nil {
		return nil, err
	} else if !ValidUsername(username) || !free {
		seed := usernameSeed(n.Name)
		if ValidUsername(username) {
			seed = username[:min(len(username), 16)]
		}
		if username, err = s.freeUsername(ctx, seed); err != nil {
			return nil, err
		}
	}
	n.Username = username
	var id int64
	err := s.db.QueryRowContext(ctx, `INSERT INTO users(name, username, picture, email, email_verified, password_hash, created_at)
VALUES (?,?,?,?,?,?,?) RETURNING id`, n.Name, n.Username, n.Picture, email, n.EmailVerified, n.PasswordHash, time.Now().Unix()).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, ErrEmailTaken
		}
		return nil, err
	}
	return &User{ID: id, Name: n.Name, Username: n.Username, Picture: n.Picture, Email: NormalizeEmail(n.Email),
		EmailVerified: n.EmailVerified, PasswordHash: n.PasswordHash}, nil
}

func (s *Store) LinkAccount(ctx context.Context, provider, subject string, userID int64) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO user_accounts(provider, subject, user_id, created_at) VALUES (?,?,?,?)
ON CONFLICT(provider, subject) DO UPDATE SET user_id = excluded.user_id`, provider, subject, userID, time.Now().Unix())
	return err
}

// RefreshProfile updates name/picture from a sign-in provider, keeping existing
// values where the provider sent nothing. The @username belongs to the user now.
func (s *Store) RefreshProfile(ctx context.Context, userID int64, name, picture string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET
  name = CASE WHEN ? <> '' THEN ? ELSE name END,
  picture = CASE WHEN ? <> '' THEN ? ELSE picture END
WHERE id = ?`, name, name, picture, picture, userID)
	return err
}

// ClaimVerifiedEmail is called when a provider (Google) proves the user owns
// the address. A password set on the account before the address was proven
// may belong to someone else, so it is removed and all sessions are revoked.
func (s *Store) ClaimVerifiedEmail(ctx context.Context, userID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var verified bool
	var hash string
	if err := tx.QueryRowContext(ctx, `SELECT email_verified, password_hash FROM users WHERE id = ?`, userID).Scan(&verified, &hash); err != nil {
		return err
	}
	if !verified && hash != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = '' WHERE id = ?`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET email_verified = 1 WHERE id = ?`, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Providers(ctx context.Context, userID int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT provider FROM user_accounts WHERE user_id = ? ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// --- sessions ---

const SessionTTL = 180 * 24 * time.Hour

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// CreateSession returns a random bearer token; only its hash is stored.
func (s *Store) CreateSession(ctx context.Context, userID int64) (string, time.Time, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", time.Time{}, err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	exp := time.Now().Add(SessionTTL)
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)`,
		hashToken(tok), userID, time.Now().Unix(), exp.Unix())
	return tok, exp, err
}

func (s *Store) SessionUser(ctx context.Context, token string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(token), time.Now().Unix()))
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	return err
}
