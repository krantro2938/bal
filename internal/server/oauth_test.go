package server

import (
	"context"
	"testing"

	"bal/internal/auth"
	"bal/internal/store"
)

func testServerStruct(t *testing.T) *Server {
	t.Helper()
	ts := newTestServer(t)
	_ = ts
	return lastServer
}

func TestUserForClaimsLinking(t *testing.T) {
	s := testServerStruct(t)
	ctx := context.Background()

	// Someone registered the victim's address with a password, unverified.
	squatter, _ := s.store.CreateUser(ctx, store.NewUser{Name: "Захватчик", Email: "victim@gmail.com", PasswordHash: "$2a$10$x"})

	// The real owner signs in with Google: same account, password dropped.
	g := &auth.Claims{Sub: "g-1", Email: "victim@gmail.com", EmailVerified: true, Name: "Вика"}
	u, err := s.userForClaims(ctx, "google", g)
	if err != nil || u.ID != squatter.ID {
		t.Fatalf("google sign-in: %+v %v", u, err)
	}
	after, _ := s.store.UserByEmail(ctx, "victim@gmail.com")
	if after.PasswordHash != "" || !after.EmailVerified {
		t.Fatalf("unproven password kept: %+v", after)
	}
	// Second Google sign-in finds the linked account directly.
	if again, _ := s.userForClaims(ctx, "google", g); again.ID != u.ID {
		t.Fatalf("relink created a new user")
	}
	// An unverified Google email never merges.
	ug, _ := s.userForClaims(ctx, "google", &auth.Claims{Sub: "g-2", Email: "victim@gmail.com", EmailVerified: false})
	if ug.ID == u.ID {
		t.Fatalf("unverified email merged")
	}
}
