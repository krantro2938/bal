package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Profile pictures from Google are copied to this site: the security policy lets pages show
// only our own images, and Google's image host isn't always reachable from Russia. Each copy
// is named after its source, so signing in again with the same picture downloads nothing.

var (
	pictureName = regexp.MustCompile(`^[0-9]+-[0-9a-f]{16}\.(jpg|png|webp)$`)
	googleSize  = regexp.MustCompile(`=s[0-9]+(-c)?$`)
)

func (s *Server) picturesDir() string { return filepath.Join(filepath.Dir(s.cfg.DBPath), "pictures") }

// copyPicture fetches the user's picture from Google and points their profile at the copy.
func (s *Server) copyPicture(ctx context.Context, userID int64, src string) error {
	u, err := url.Parse(src)
	if err != nil || u.Scheme != "https" || !strings.HasSuffix(u.Hostname(), ".googleusercontent.com") {
		return fmt.Errorf("picture of user %d: not a Google image address", userID)
	}
	sum := sha256.Sum256([]byte(src))
	base := fmt.Sprintf("%d-%s", userID, hex.EncodeToString(sum[:8]))
	dir := s.picturesDir()
	for _, ext := range []string{"jpg", "png", "webp"} {
		if _, err := os.Stat(filepath.Join(dir, base+"."+ext)); err == nil {
			return s.store.ReplacePicture(ctx, userID, src, "/pictures/"+base+"."+ext)
		}
	}
	// Google sends 96 px by default; ask for enough for the account page's 112 px at 2×.
	big := googleSize.ReplaceAllString(src, "=s256-c")
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, big, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("picture of user %d: %s", userID, resp.Status)
	}
	ext := map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[strings.Split(resp.Header.Get("Content-Type"), ";")[0]]
	if ext == "" {
		return fmt.Errorf("picture of user %d: unexpected %q", userID, resp.Header.Get("Content-Type"))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20+1))
	if err != nil {
		return err
	}
	if len(body) > 2<<20 {
		return fmt.Errorf("picture of user %d: too large", userID)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	name := base + "." + ext
	tmp := filepath.Join(dir, "."+name)
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, filepath.Join(dir, name)); err != nil {
		return err
	}
	// Earlier copies of this user's picture go.
	if old, _ := filepath.Glob(filepath.Join(dir, fmt.Sprintf("%d-*", userID))); len(old) > 0 {
		for _, f := range old {
			if filepath.Base(f) != name {
				os.Remove(f)
			}
		}
	}
	return s.store.ReplacePicture(ctx, userID, src, "/pictures/"+name)
}

// copyPictures copies every picture still pointing at Google (at start-up, for accounts
// from before this, and for a sign-in whose copy failed then).
func (s *Server) copyPictures(ctx context.Context) {
	pics, err := s.store.ExternalPictures(ctx)
	if err != nil {
		logErr(err)
		return
	}
	for id, src := range pics {
		if err := s.copyPicture(ctx, id, src); err != nil {
			s.cfg.Log.Printf("pictures: %v", err)
		}
	}
}

// handlePicture serves a copied picture. Names change with the picture, so they keep forever.
func (s *Server) handlePicture(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !pictureName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filepath.Join(s.picturesDir(), name))
}
