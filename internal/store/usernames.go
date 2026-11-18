package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// Usernames are the public @handles in comments and mentions: lower-case Latin letters,
// digits, "_" and ".", starting with a letter. Everyone gets one on sign-up, made from
// their name plus digits, and can change it later.

var ErrUsernameTaken = errors.New("username taken")

var usernameRe = regexp.MustCompile(`^[a-z][a-z0-9_.]{2,29}$`)

func NormalizeUsername(u string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(u), "@"))
}

func ValidUsername(u string) bool { return usernameRe.MatchString(u) }

var translit = map[rune]string{
	'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "e", 'ж': "zh", 'з': "z", 'и': "i", 'й': "y",
	'к': "k", 'л': "l", 'м': "m", 'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u", 'ф': "f",
	'х': "kh", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "sch", 'ъ': "", 'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",
}

// usernameSeed turns a name into the start of a handle: «Анна Петрова» → "annapetrova".
func usernameSeed(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if t, ok := translit[r]; ok {
			b.WriteString(t)
		} else if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	s := strings.TrimLeft(b.String(), "0123456789")
	if len(s) > 16 {
		s = s[:16]
	}
	if len(s) < 3 {
		s = "dancer"
	}
	return s
}

// freeUsername finds an unused handle: the seed plus a few random digits.
func (s *Store) freeUsername(ctx context.Context, seed string) (string, error) {
	for i := 0; i < 40; i++ {
		max := int64(900)
		if i >= 20 {
			max = 90000
		}
		n, err := rand.Int(rand.Reader, big.NewInt(max))
		if err != nil {
			return "", err
		}
		u := fmt.Sprintf("%s%d", seed, n.Int64()+max/9)
		var taken int
		if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE username = ?`, u).Scan(&taken); err != nil {
			return "", err
		}
		if taken == 0 {
			return u, nil
		}
	}
	return "", errors.New("no free username")
}

// SetUsername changes a user's handle; ErrUsernameTaken if someone has it.
func (s *Store) SetUsername(ctx context.Context, userID int64, username string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET username = ? WHERE id = ?`, username, userID)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrUsernameTaken
	}
	return err
}

// UsernameFree reports whether nobody but userID has the handle.
func (s *Store) UsernameFree(ctx context.Context, username string, userID int64) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE username = ? AND id <> ?`, username, userID).Scan(&n)
	return n == 0, err
}

// UserIDsByUsername resolves @handles to user ids; unknown handles are left out.
func (s *Store) UserIDsByUsername(ctx context.Context, names []string) (map[string]int64, error) {
	out := map[string]int64{}
	for _, n := range names {
		var id int64
		err := s.db.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ?`, n).Scan(&id)
		if err == nil {
			out[n] = id
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	return out, nil
}

// ensureUsernames gives every user a valid, unique handle (older accounts had none or
// kept their Telegram username) and then enforces uniqueness with an index.
func (s *Store) ensureUsernames() error {
	ctx := context.Background()
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, username FROM users ORDER BY id`)
	if err != nil {
		return err
	}
	type row struct {
		id             int64
		name, username string
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.name, &r.username); err != nil {
			rows.Close()
			return err
		}
		all = append(all, r)
	}
	rows.Close()
	seen := map[string]bool{}
	for _, r := range all {
		u := NormalizeUsername(r.username)
		if ValidUsername(u) && !seen[u] {
			seen[u] = true
			if u != r.username {
				if _, err := s.db.ExecContext(ctx, `UPDATE users SET username = ? WHERE id = ?`, u, r.id); err != nil {
					return err
				}
			}
			continue
		}
		seed := usernameSeed(r.name)
		if ValidUsername(u) {
			seed = u[:min(len(u), 16)]
		}
		for {
			if u, err = s.freeUsername(ctx, seed); err != nil {
				return err
			}
			if !seen[u] {
				break
			}
		}
		seen[u] = true
		if _, err := s.db.ExecContext(ctx, `UPDATE users SET username = ? WHERE id = ?`, u, r.id); err != nil {
			return err
		}
	}
	_, err = s.db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username) WHERE username <> ''`)
	return err
}
