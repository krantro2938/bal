package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// pinnedFile is content/pinned.json: the site's own account and the comment it keeps
// pinned under each dance (exam notes). It is synced at start-up, so editing the file and
// deploying updates the text in place (likes and replies stay). A comment is pinned when
// it is first posted; after that moderators may pin something else.
type pinnedFile struct {
	Account struct {
		Name     string `json:"name"`
		Username string `json:"username"`
		Picture  string `json:"picture"`
	} `json:"account"`
	Comments []struct {
		Dance string `json:"dance"`
		Body  string `json:"body"`
	} `json:"comments"`
}

func (s *Server) syncPinned(ctx context.Context) error {
	path := filepath.Join(filepath.Dir(s.cfg.SourcesPath), "pinned.json")
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	var f pinnedFile
	if err := json.Unmarshal(b, &f); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	src, _, err := s.lib.Snapshot()
	if err != nil {
		return err
	}
	for _, c := range f.Comments {
		if src.Find(c.Dance) == nil {
			return fmt.Errorf("%s: unknown dance %q", path, c.Dance)
		}
		if n := utf8.RuneCountInString(strings.TrimSpace(c.Body)); n == 0 || n > maxComment {
			return fmt.Errorf("%s: %s: comment is empty or longer than %d characters", path, c.Dance, maxComment)
		}
	}
	official, err := s.store.EnsureOfficial(ctx, f.Account.Name, f.Account.Username, f.Account.Picture)
	if err != nil {
		return err
	}
	s.official = &official
	changed := 0
	for _, c := range f.Comments {
		_, ok, err := s.store.UpsertOwnComment(ctx, official.ID, c.Dance, strings.TrimSpace(c.Body))
		if err != nil {
			return err
		}
		if ok {
			changed++
		}
	}
	s.cfg.Log.Printf("pinned comments: @%s, %d dances, %d updated", official.Username, len(f.Comments), changed)
	return nil
}
