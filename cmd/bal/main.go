// Command bal is the rehearsal site: media import/preparation and the HTTP server.
//
//	bal import  --from ~/Downloads      move Telegram downloads into the raw dir
//	bal contact vals-gavot              contact sheet for choosing a cover frame
//	bal prepare [slug ...]              build web media (all dances if no slug)
//	bal serve                           run the HTTP server
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"bal/internal/content"
	"bal/internal/prepare"
	"bal/internal/server"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// loadDotEnv sets variables from ./.env that are not already in the
// environment, so `./bal serve` picks up local credentials without exporting them.
func loadDotEnv() {
	b, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		if _, set := os.LookupEnv(strings.TrimSpace(k)); !set {
			os.Setenv(strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`))
		}
	}
}

func main() {
	loadDotEnv()
	if len(os.Args) < 2 {
		usage()
	}
	cmd, args := os.Args[1], os.Args[2:]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	sourcesPath := fs.String("sources", env("BAL_SOURCES", "content/sources.json"), "source record")
	rawDir := fs.String("raw", env("BAL_RAW_DIR", "var/raw"), "original downloads, by slug")
	mediaDir := fs.String("media", env("BAL_MEDIA_DIR", "var/media"), "generated web media")
	logger := log.New(os.Stderr, "", log.LstdFlags)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch cmd {
	case "import":
		from := fs.String("from", filepath.Join(os.Getenv("HOME"), "Downloads"), "directory with Telegram downloads")
		cp := fs.Bool("copy", false, "copy instead of move")
		fs.Parse(args)
		src := must(content.LoadSources(*sourcesPath))
		cfg := prepare.Config{RawDir: *rawDir, MediaDir: *mediaDir, Log: logger}
		check(prepare.Import(src, *from, cfg, *cp))
		check(src.Save(*sourcesPath))
		report(src)

	case "prepare":
		force := fs.Bool("force", false, "rebuild existing outputs")
		fs.Parse(args)
		src := must(content.LoadSources(*sourcesPath))
		cfg := prepare.Config{RawDir: *rawDir, MediaDir: *mediaDir, Force: *force, Log: logger}
		slugs := fs.Args()
		if len(slugs) == 0 {
			for _, d := range src.Dances {
				slugs = append(slugs, d.Slug)
			}
		}
		failed := 0
		for _, slug := range slugs {
			d := src.Find(slug)
			if d == nil {
				logger.Fatalf("unknown slug %q", slug)
			}
			m, err := prepare.Prepare(ctx, d, cfg)
			if err != nil {
				logger.Printf("FAIL %v", err)
				failed++
				continue
			}
			logger.Printf("ok   %-24s %s %dx%d@%s %.2fs %.1f MB (%s) schemes=%d audio=%d",
				slug, m.Version, m.Video.Width, m.Video.Height, m.Video.FPS, m.Video.Duration,
				float64(m.Video.Bytes)/1e6, m.Video.Mode, len(m.Schemes), len(m.Audio))
		}
		if failed > 0 {
			os.Exit(1)
		}

	case "contact":
		every := fs.Float64("every", 5, "seconds between frames")
		out := fs.String("out", "", "output JPEG (default var/work/<slug>-contact.jpg)")
		fs.Parse(args)
		src := must(content.LoadSources(*sourcesPath))
		cfg := prepare.Config{RawDir: *rawDir, MediaDir: *mediaDir, Log: logger}
		for _, slug := range fs.Args() {
			d := src.Find(slug)
			if d == nil {
				logger.Fatalf("unknown slug %q", slug)
			}
			o := *out
			if o == "" {
				os.MkdirAll("var/work", 0o755)
				o = filepath.Join("var/work", slug+"-contact.jpg")
			}
			check(prepare.Contact(ctx, d, cfg, *every, o))
			fmt.Println(o)
		}

	case "report":
		fs.Parse(args)
		lib := &content.Library{SourcesPath: *sourcesPath, MediaDir: *mediaDir}
		src, metas, err := lib.Snapshot()
		check(err)
		fmt.Print(assetReport(src, metas))

	case "serve":
		cfg := server.Config{}
		fs.StringVar(&cfg.Addr, "addr", env("BAL_ADDR", "127.0.0.1:8080"), "listen address")
		fs.StringVar(&cfg.DBPath, "db", env("BAL_DB", "var/data/bal.db"), "SQLite database")
		fs.StringVar(&cfg.StaticDir, "static", env("BAL_STATIC_DIR", "web/dist"), "built frontend")
		fs.StringVar(&cfg.PublicURL, "public-url", env("BAL_PUBLIC_URL", "http://localhost:8080"), "external base URL (OAuth redirects)")
		fs.StringVar(&cfg.ShareURL, "share-url", env("BAL_SHARE_URL", ""), "host for shared links that preview bots can reach")
		fs.StringVar(&cfg.FrontendURL, "frontend-url", env("BAL_FRONTEND_URL", ""), "where pages are served if not the public URL (Vite in development)")
		fs.Parse(args)
		cfg.SourcesPath, cfg.MediaDir = *sourcesPath, *mediaDir
		cfg.GoogleClientID = os.Getenv("BAL_GOOGLE_CLIENT_ID")
		cfg.GoogleClientSecret = os.Getenv("BAL_GOOGLE_CLIENT_SECRET")
		cfg.DevLogin = os.Getenv("BAL_DEV_LOGIN") == "1"
		cfg.TrustProxy = os.Getenv("BAL_TRUST_PROXY") == "1"
		cfg.Log = logger
		check(server.Run(ctx, cfg))

	default:
		usage()
	}
}

func assetReport(src *content.Sources, metas map[string]*content.Meta) string {
	var b strings.Builder
	b.WriteString("# Материалы: что получено\n\n")
	b.WriteString("Generated by `bal report` from content/sources.json and var/media/*/meta.json.\n\n")
	b.WriteString("| # | Танец | Видео (оригинал → сайт) | Схема | Музыка |\n|---|---|---|---|---|\n")
	for _, d := range src.Dances {
		m := metas[d.Slug]
		var video, schemes, audio []string
		for _, a := range d.Assets {
			cell := fmt.Sprintf("[%s](%s) `%s`", strings.TrimPrefix(a.Post, "https://t.me/bal_rtumirea/"), a.Post, a.OriginalFilename)
			if a.Status != "obtained" {
				cell += " — **только ссылка**"
			}
			switch a.Kind {
			case "video":
				if m != nil {
					cell += fmt.Sprintf(" → %dx%d@%s, %s, %.1f→%.1f MB (%s)", m.Video.Width, m.Video.Height, m.Video.FPS,
						durationString(m.Video.Duration), float64(m.Video.Source.Bytes)/1e6, float64(m.Video.Bytes)/1e6, m.Video.Mode)
				}
				video = append(video, cell)
			case "scheme":
				schemes = append(schemes, cell)
			case "audio":
				audio = append(audio, cell)
			}
		}
		none := func(xs []string) string {
			if len(xs) == 0 {
				return "нет в канале"
			}
			return strings.Join(xs, "<br>")
		}
		fmt.Fprintf(&b, "| %d | %s | %s | %s | %s |\n", d.Order, d.Title, none(video), none(schemes), none(audio))
	}
	return b.String()
}

func durationString(s float64) string {
	t := int(s + 0.5)
	return fmt.Sprintf("%d:%02d", t/60, t%60)
}

func report(src *content.Sources) {
	counts := map[string]int{}
	for _, d := range src.Dances {
		for _, a := range d.Assets {
			counts[a.Kind+"/"+a.Status]++
			if a.Status != "obtained" {
				fmt.Printf("  %-24s %-6s %-8s %s\n", d.Slug, a.Kind, a.Status, a.Post)
			}
		}
	}
	fmt.Println(counts)
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: bal import|contact|prepare|serve [flags]")
	os.Exit(2)
}

func must[T any](v T, err error) T {
	check(err)
	return v
}

func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
