package server

import (
	"fmt"
	"html"
	"html/template"
	"image/jpeg"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const defaultDescription = "Видео-инструкции, схемы и музыка танцев 14-го Традиционного бала РТУ МИРЭА «Звёздная Одиссея». Повтор фрагментов, замедление и личные заметки."

// pageMeta is what link previews (Telegram, VK, search engines) see without
// running JavaScript: title, description, image and canonical URL.
type pageMeta struct {
	Title, ShareTitle, Description, Image, Path string
	ImageWidth, ImageHeight                     int
}

var sharePage = template.Must(template.New("share").Parse(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{.Title}}</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Звёздная одиссея">
  <meta property="og:title" content="{{.ShareTitle}}">
  <meta property="og:description" content="{{.Description}}">
  <meta property="og:image" content="{{.Image}}">
  {{if .ImageWidth}}<meta property="og:image:width" content="{{.ImageWidth}}">
  <meta property="og:image:height" content="{{.ImageHeight}}">{{end}}
  <meta property="og:url" content="{{.URL}}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{.ShareTitle}}">
  <meta name="twitter:description" content="{{.Description}}">
  <meta name="twitter:image" content="{{.Image}}">
</head>
<body>
  <main>
    <h1>{{.Title}}</h1>
    <p>{{.Description}}</p>
    <a href="{{.Destination}}">Открыть сайт репетиций</a>
  </main>
</body>
</html>`))

func (s *Server) metaFor(path string) pageMeta {
	m := pageMeta{
		Title: "Звёздная одиссея · Репетиции бала", ShareTitle: "Репетиции бала", Description: defaultDescription,
		Image: "/og.png", Path: path, ImageWidth: 1200, ImageHeight: 630,
	}
	slug, ok := strings.CutPrefix(path, "/dance/")
	if !ok || strings.Contains(slug, "/") {
		return m
	}
	src, metas, err := s.lib.Snapshot()
	if err != nil {
		return m
	}
	if d := src.Find(slug); d != nil {
		m.Title = d.Title + " · Звёздная одиссея"
		m.ShareTitle = d.Title
		m.Description = d.Description
		if metas[slug] != nil {
			poster := slug + "/poster.jpg"
			posterPath := filepath.Join(s.cfg.MediaDir, poster)
			if info, err := os.Stat(posterPath); err == nil && info.Mode().IsRegular() {
				m.Image = mediaURL(poster)
				m.ImageWidth, m.ImageHeight = jpegDimensions(posterPath)
			}
		}
	}
	return m
}

func jpegDimensions(path string) (width, height int) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	config, err := jpeg.DecodeConfig(f)
	if err != nil {
		return 0, 0
	}
	return config.Width, config.Height
}

func (s *Server) serveSharePage(w http.ResponseWriter, r *http.Request, path string) {
	m := s.metaFor(path)
	base := strings.TrimRight(s.cfg.ShareURL, "/")
	requestURL := (&url.URL{Path: path, RawQuery: r.URL.RawQuery}).String()
	m.Image = base + m.Image
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if err := sharePage.Execute(w, struct {
		pageMeta
		URL, Destination string
	}{m, base + requestURL, strings.TrimRight(s.cfg.PublicURL, "/") + requestURL}); err != nil {
		s.cfg.Log.Printf("serve share page: %v", err)
	}
}

// renderIndex fills the meta tags in index.html for this page.
func (s *Server) renderIndex(dir, path string) ([]byte, error) {
	b, err := os.ReadFile(filepath.Join(dir, "index.html"))
	if err != nil {
		return nil, err
	}
	m := s.metaFor(path)
	base := strings.TrimRight(s.cfg.PublicURL, "/")
	page := string(b)
	attr := func(v string) string { return html.EscapeString(v) }
	repl := []string{
		"<title>Звёздная одиссея · Репетиции</title>", "<title>" + attr(m.Title) + "</title>",
		`<meta property="og:title" content="Звёздная одиссея · Репетиции бала" />`, `<meta property="og:title" content="` + attr(m.Title) + `" />`,
		`<meta property="og:image" content="/og.png" />`, `<meta property="og:image" content="` + attr(base+m.Image) + `" />`,
		`<meta property="og:url" content="/" />`, `<meta property="og:url" content="` + attr(base+m.Path) + `" />` +
			"\n    " + `<link rel="canonical" href="` + attr(base+m.Path) + `" />`,
	}
	if m.Description != defaultDescription {
		repl = append(repl, `content="`+defaultDescription+`"`, `content="`+attr(m.Description)+`"`)
	}
	if m.Image != "/og.png" { // dance posters are 1280×720
		repl = append(repl, `<meta property="og:image:width" content="1200" />`, `<meta property="og:image:width" content="1280" />`,
			`<meta property="og:image:height" content="630" />`, `<meta property="og:image:height" content="720" />`)
	}
	return []byte(strings.NewReplacer(repl...).Replace(page)), nil
}

func (s *Server) handleRobots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintf(w, "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nDisallow: /me\n\nSitemap: %s/sitemap.xml\n", strings.TrimRight(s.cfg.PublicURL, "/"))
}

func (s *Server) handleSitemap(w http.ResponseWriter, r *http.Request) {
	src, _, err := s.lib.Snapshot()
	if err != nil {
		httpError(w, err)
		return
	}
	base := strings.TrimRight(s.cfg.PublicURL, "/")
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	fmt.Fprint(w, `<?xml version="1.0" encoding="UTF-8"?>`+"\n"+`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`+"\n")
	fmt.Fprintf(w, "  <url><loc>%s/</loc></url>\n", base)
	for _, d := range src.Dances {
		fmt.Fprintf(w, "  <url><loc>%s/dance/%s</loc></url>\n", base, d.Slug)
	}
	fmt.Fprint(w, "</urlset>\n")
}
