package server

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// mediaHandler serves prepared media with http.FileServer, which implements
// Range, If-Range and conditional requests. Directory listings are refused.
func mediaHandler(dir string) http.Handler {
	fs := http.FileServer(noDirs{http.Dir(dir)})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := path.Base(r.URL.Path)
		switch {
		case strings.HasPrefix(name, "video-") && strings.HasSuffix(name, ".mp4"):
			// The version hash is in the filename, so the file never changes.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case name == "meta.json":
			http.NotFound(w, r)
			return
		default:
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		fs.ServeHTTP(w, r)
	})
}

type noDirs struct{ http.FileSystem }

func (n noDirs) Open(name string) (http.File, error) {
	f, err := n.FileSystem.Open(name)
	if err != nil {
		return nil, err
	}
	if st, err := f.Stat(); err == nil && st.IsDir() {
		f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

// spaHandler serves the built frontend; unknown paths get index.html so
// client-side routes like /dance/vals-gavot work on reload.
func (s *Server) spaHandler(dir string) http.Handler {
	files := http.FileServer(noDirs{http.Dir(dir)})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean("/" + r.URL.Path)
		if strings.HasPrefix(clean, "/api/") {
			http.NotFound(w, r)
			return
		}
		if clean != "/" {
			if st, err := os.Stat(filepath.Join(dir, filepath.FromSlash(clean))); err == nil && !st.IsDir() {
				if strings.HasPrefix(clean, "/assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		page, err := s.renderIndex(dir, clean, r.Header.Get("X-Bal-Share") != "")
		if err != nil {
			http.Error(w, "frontend not built: run `npm --prefix web run build`", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(page)
	})
}
