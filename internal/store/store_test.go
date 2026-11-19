package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// A database created by the first release keeps its users and notes, and
// Telegram identities move to user_accounts.
func TestMigrateFromV1(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(migrations[0]); err != nil {
		t.Fatal(err)
	}
	db.Exec(`INSERT INTO users(id, provider, subject, name, created_at) VALUES (7, 'telegram', '42', 'Анна', 1)`)
	db.Exec(`INSERT INTO notes(user_id, dance, version, t, text, created_at, updated_at) VALUES (7, 'vals-gavot', 'v1', 77, 'поворот', 1, 1)`)
	db.Close()

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	u, err := s.UserByAccount(ctx, "telegram", "42")
	if err != nil || u.ID != 7 || u.Name != "Анна" {
		t.Fatalf("user after migration: %+v %v", u, err)
	}
	notes, _ := s.Notes(ctx, 7, "")
	if len(notes) != 1 || notes[0].Text != "поворот" {
		t.Fatalf("notes lost: %+v", notes)
	}
	// Re-opening is a no-op.
	s.Close()
	if s, err = Open(path); err != nil {
		t.Fatal(err)
	}
}

func TestClaimVerifiedEmailDropsUnprovenPassword(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	u, err := s.CreateUser(ctx, NewUser{Name: "Чужой", Email: "Victim@Example.com", PasswordHash: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(ctx, NewUser{Name: "Дубль", Email: "victim@example.com "}); err != ErrEmailTaken {
		t.Fatalf("duplicate email: %v", err)
	}
	tok, _, _ := s.CreateSession(ctx, u.ID)
	if err := s.ClaimVerifiedEmail(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := s.UserByEmail(ctx, "victim@example.com")
	if got.PasswordHash != "" || !got.EmailVerified {
		t.Fatalf("after claim: %+v", got)
	}
	if _, err := s.SessionUser(ctx, tok); err != ErrNotFound {
		t.Fatalf("old session survived: %v", err)
	}
}

func TestReactions(t *testing.T) {
	s, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer s.Close()
	ctx := context.Background()
	a, _ := s.CreateUser(ctx, NewUser{Name: "a"})
	b, _ := s.CreateUser(ctx, NewUser{Name: "b"})
	s.SetReaction(ctx, a.ID, "d", 1)
	s.SetReaction(ctx, b.ID, "d", 1)
	s.SetReaction(ctx, b.ID, "d", -1) // change of mind replaces, not adds
	c, _ := s.ReactionCounts(ctx, a.ID)
	if c["d"] != (Reactions{Likes: 1, Dislikes: 1, Mine: 1}) {
		t.Fatalf("counts %+v", c["d"])
	}
	s.SetReaction(ctx, a.ID, "d", 0)
	c, _ = s.ReactionCounts(ctx, 0)
	if c["d"] != (Reactions{Likes: 0, Dislikes: 1}) {
		t.Fatalf("after unlike %+v", c["d"])
	}
}

// Older accounts get valid, unique usernames: duplicates and invalid Telegram handles are replaced.
func TestEnsureUsernames(t *testing.T) {
	path := filepath.Join(t.TempDir(), "u.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(migrations[0]); err != nil {
		t.Fatal(err)
	}
	db.Exec(`INSERT INTO users(id, provider, subject, name, username, created_at) VALUES
  (1, 'telegram', '1', 'Анна', 'Anna_K', 1), (2, 'telegram', '2', 'Анна', 'anna_k', 1),
  (3, 'telegram', '3', 'Борис', '', 1), (4, 'telegram', '4', 'Ёж', '9lives', 1)`)
	db.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got := map[int64]string{}
	rows, _ := s.db.Query(`SELECT id, username FROM users`)
	for rows.Next() {
		var id int64
		var u string
		rows.Scan(&id, &u)
		got[id] = u
	}
	rows.Close()
	if got[1] != "anna_k" || got[2] == "anna_k" || !ValidUsername(got[2]) || !strings.HasPrefix(got[3], "boris") || !ValidUsername(got[4]) {
		t.Fatalf("usernames %v", got)
	}
	if err := s.SetUsername(context.Background(), 3, "anna_k"); err != ErrUsernameTaken {
		t.Fatalf("duplicate allowed: %v", err)
	}
}

func TestOfficialPinnedComment(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	a, err := s.EnsureOfficial(ctx, "Репетиции бала", "bal", "/icons/icon-192.png")
	if err != nil || !a.Verified || a.Username != "bal" {
		t.Fatalf("EnsureOfficial = %+v, %v", a, err)
	}
	if again, _ := s.EnsureOfficial(ctx, "Репетиции бала", "bal", ""); again.ID != a.ID {
		t.Fatalf("second EnsureOfficial made a new account: %d vs %d", again.ID, a.ID)
	}
	c, changed, err := s.UpsertOwnComment(ctx, a.ID, "vals", "first")
	if err != nil || !changed || !c.Pinned || !c.Author.Verified || c.Status != "published" {
		t.Fatalf("create: %+v changed=%v err=%v", c, changed, err)
	}
	if _, changed, _ := s.UpsertOwnComment(ctx, a.ID, "vals", "first"); changed {
		t.Fatal("same text reported as a change")
	}
	// A moderator pins another comment; a text update keeps that choice.
	other, _ := s.CreateComment(ctx, a.ID, Comment{Dance: "vals", Body: "x", Status: "published"})
	s.db.Exec(`UPDATE comments SET created_at = created_at + 1000 WHERE id = ?`, other.ID)
	s.PinComment(ctx, "vals", other.ID, true)
	c2, changed, _ := s.UpsertOwnComment(ctx, a.ID, "vals", "second")
	if !changed || c2.ID != c.ID || c2.Body != "second" || c2.Pinned {
		t.Fatalf("update: %+v changed=%v", c2, changed)
	}
}

func TestProfile(t *testing.T) {
	s, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer s.Close()
	ctx := context.Background()
	u, _ := s.CreateUser(ctx, NewUser{Name: "Аня", Username: "anya"})
	fan, _ := s.CreateUser(ctx, NewUser{Name: "Боря", Username: "borya"})
	c, _ := s.CreateComment(ctx, u.ID, Comment{Dance: "vals", Body: "hi", Status: "published"})
	s.CreateComment(ctx, u.ID, Comment{Dance: "vals", Body: "held", Status: "held"})
	s.LikeComment(ctx, fan.ID, c.ID, true)
	p, err := s.ProfileByUsername(ctx, "@Anya")
	if err != nil || p.Comments != 1 || p.Likes != 1 || p.LastComment != c.CreatedAt || p.CreatedAt == 0 {
		t.Fatalf("profile = %+v, %v", p, err)
	}
	list, _ := s.UserComments(ctx, u.ID, fan.ID, 10)
	if len(list) != 1 || !list[0].Liked {
		t.Fatalf("comments = %+v", list)
	}
	if _, err := s.ProfileByUsername(ctx, "nobody"); err != ErrNotFound {
		t.Fatalf("missing user: %v", err)
	}
}

func TestAnnounceOnlyNewDances(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	// The first check only records what is already on the site.
	if fresh, err := s.Announce(ctx, []string{"a", "b"}); err != nil || len(fresh) != 0 {
		t.Fatalf("first check: %v %v", fresh, err)
	}
	if fresh, err := s.Announce(ctx, []string{"a", "b", "c"}); err != nil || len(fresh) != 1 || fresh[0] != "c" {
		t.Fatalf("new dance: %v %v", fresh, err)
	}
	if fresh, err := s.Announce(ctx, []string{"a", "b", "c"}); err != nil || len(fresh) != 0 {
		t.Fatalf("again: %v %v", fresh, err)
	}
}

func TestReplacePictureOnlyIfUnchanged(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	src := "https://lh3.googleusercontent.com/a/x=s96-c"
	u, err := s.CreateUser(ctx, NewUser{Name: "A", Username: "a", Picture: src})
	if err != nil {
		t.Fatal(err)
	}
	if pics, _ := s.ExternalPictures(ctx); pics[u.ID] != src {
		t.Fatalf("external pictures: %v", pics)
	}
	// A picture that changed since the download started is left alone.
	if err := s.ReplacePicture(ctx, u.ID, "https://other", "/pictures/x.jpg"); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplacePicture(ctx, u.ID, src, "/pictures/1-abc.jpg"); err != nil {
		t.Fatal(err)
	}
	if pics, _ := s.ExternalPictures(ctx); len(pics) != 0 {
		t.Fatalf("still external: %v", pics)
	}
}
