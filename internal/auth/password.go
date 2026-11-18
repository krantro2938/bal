package auth

import (
	"regexp"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var emailRe = regexp.MustCompile(`^[a-zA-Z0-9.!#$%&'*+/=?^_` + "`" + `{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$`)

func ValidEmail(e string) bool { return len(e) <= 254 && emailRe.MatchString(e) }

// ValidPassword keeps sign-up quick: at least 8 characters, and at most 72
// bytes because bcrypt ignores anything longer.
func ValidPassword(p string) bool { return utf8.RuneCountInString(p) >= 8 && len(p) <= 72 }

func HashPassword(p string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
	return string(h), err
}

// dummyHash is compared against when the email is unknown, so a login takes
// the same time whether or not the account exists.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcrypt.DefaultCost)

func CheckPassword(hash, p string) bool {
	if hash == "" {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(p))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(p)) == nil
}
