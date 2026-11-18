// Package content describes the dance catalog: the hand-checked source record
// (content/sources.json) and the media metadata written by `bal prepare`.
package content

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Sources is content/sources.json.
type Sources struct {
	Channel string   `json:"channel"`
	Edition string   `json:"edition"`
	Dances  []Source `json:"dances"`
}

type Source struct {
	Slug        string    `json:"slug"`
	Order       int       `json:"order"`
	Title       string    `json:"title"`
	Kind        string    `json:"kind"` // "dance" or "glossary"
	Description string    `json:"description"`
	SourcePost  string    `json:"sourcePost"`
	CaptionPost string    `json:"captionPost"`
	Caption     string    `json:"caption"`
	Assets      []Asset   `json:"assets"`
	Chapters    *Chapters `json:"chapters,omitempty"`
	// Published is when the tutorial video was posted in the channel (RFC 3339).
	Published string `json:"published,omitempty"`
	// CoverAt is the hand-picked second of the tutorial used as the cover frame.
	CoverAt *float64 `json:"coverAt,omitempty"`
}

type Asset struct {
	Kind             string `json:"kind"` // video, scheme, audio
	Post             string `json:"post"`
	OriginalFilename string `json:"originalFilename"`
	DownloadedAs     string `json:"downloadedAs"`
	// Status is "obtained" (file in raw dir), "linked" (only available in
	// Telegram) or "missing". Filled in by `bal import`.
	Status string `json:"status,omitempty"`
	SHA256 string `json:"sha256,omitempty"`
}

type Chapters struct {
	Source string    `json:"source"`
	Items  []Chapter `json:"items"`
}

type Chapter struct {
	Start float64 `json:"start"`
	End   float64 `json:"end,omitempty"`
	Title string  `json:"title"`
}

func LoadSources(path string) (*Sources, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s Sources
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	sort.SliceStable(s.Dances, func(i, j int) bool { return s.Dances[i].Order < s.Dances[j].Order })
	return &s, nil
}

func (s *Sources) Save(path string) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}

func (s *Sources) Find(slug string) *Source {
	for i := range s.Dances {
		if s.Dances[i].Slug == slug {
			return &s.Dances[i]
		}
	}
	return nil
}

// Meta is <media>/<slug>/meta.json, written by `bal prepare`. All paths are
// relative to the media root and served under /media/.
type Meta struct {
	Slug       string       `json:"slug"`
	Version    string       `json:"version"`
	PreparedAt time.Time    `json:"preparedAt"`
	Video      VideoMeta    `json:"video"`
	Poster     PosterMeta   `json:"poster"`
	Thumbnails string       `json:"thumbnails"`        // WebVTT with sprite xywh cues
	Preview    string       `json:"preview,omitempty"` // short muted low-res loop for hover
	Schemes    []SchemeMeta `json:"schemes"`
	Audio      []AudioMeta  `json:"audio"`
}

type VideoMeta struct {
	Path     string  `json:"path"`
	Duration float64 `json:"duration"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	FPS      string  `json:"fps"`
	Bytes    int64   `json:"bytes"`
	Bitrate  int64   `json:"bitrate"`
	Mode     string  `json:"mode"` // "remux" or "transcode"
	Source   struct {
		Filename string  `json:"filename"`
		SHA256   string  `json:"sha256"`
		Bytes    int64   `json:"bytes"`
		Bitrate  int64   `json:"bitrate"`
		Duration float64 `json:"duration"`
		Codec    string  `json:"codec"`
	} `json:"source"`
}

type PosterMeta struct {
	Path  string  `json:"path"`  // 1280w
	Small string  `json:"small"` // 640w
	At    float64 `json:"at"`
}

type SchemeMeta struct {
	Path   string `json:"path"`
	Thumb  string `json:"thumb"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Post   string `json:"post"`
}

type AudioMeta struct {
	Path     string  `json:"path"`
	Title    string  `json:"title"`
	Duration float64 `json:"duration"`
	Post     string  `json:"post"`
	Original string  `json:"original"`
}

// Library combines sources with whatever media has been prepared. It rescans
// meta.json files lazily so a freshly prepared dance appears without restart.
type Library struct {
	SourcesPath string
	MediaDir    string

	mu      sync.Mutex
	loaded  time.Time
	sources *Sources
	metas   map[string]*Meta
}

const rescanEvery = 15 * time.Second

func (l *Library) Snapshot() (*Sources, map[string]*Meta, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.sources != nil && time.Since(l.loaded) < rescanEvery {
		return l.sources, l.metas, nil
	}
	src, err := LoadSources(l.SourcesPath)
	if err != nil {
		return nil, nil, err
	}
	metas := map[string]*Meta{}
	for _, d := range src.Dances {
		m, err := ReadMeta(l.MediaDir, d.Slug)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, nil, err
		}
		metas[d.Slug] = m
	}
	l.sources, l.metas, l.loaded = src, metas, time.Now()
	return src, metas, nil
}

func ReadMeta(mediaDir, slug string) (*Meta, error) {
	b, err := os.ReadFile(filepath.Join(mediaDir, slug, "meta.json"))
	if err != nil {
		return nil, err
	}
	var m Meta
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("%s meta: %w", slug, err)
	}
	return &m, nil
}
