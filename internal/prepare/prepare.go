// Package prepare turns the original Telegram downloads into web media:
// a fast-start MP4, a cover frame, timeline sprites with WebVTT, scheme
// images and practice audio, plus a meta.json catalog entry per dance.
package prepare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"

	"bal/internal/content"
)

const (
	// Sources at or below this bitrate are remuxed untouched. Above it the
	// file is re-encoded at the same resolution and frame rate: the 1080p
	// tutorials arrive at ~17 Mbit/s (345 MB for 2:51), which stalls on
	// phone connections and costs guests hundreds of megabytes per dance.
	MaxRemuxBitrate     = 6_000_000
	SeekKeyframeSeconds = 2

	ThumbInterval = 2.0 // seconds between timeline previews
	ThumbWidth    = 192
	SpriteCols    = 8
	SpriteRows    = 8
)

type Config struct {
	RawDir   string // originals: <raw>/<slug>/<original filename>
	MediaDir string // generated: <media>/<slug>/...
	Force    bool   // rebuild even if outputs exist
	Log      *log.Logger
}

// Import moves (or copies) downloaded files into the raw directory under
// their original names and records the status and checksum of every asset.
func Import(src *content.Sources, from string, cfg Config, copyFiles bool) error {
	entries, err := os.ReadDir(from)
	if err != nil {
		return err
	}
	byNFC := map[string]string{}
	for _, e := range entries {
		byNFC[norm.NFC.String(e.Name())] = e.Name()
	}
	for di := range src.Dances {
		d := &src.Dances[di]
		for ai := range d.Assets {
			a := &d.Assets[ai]
			dst := filepath.Join(cfg.RawDir, d.Slug, norm.NFC.String(a.OriginalFilename))
			if _, err := os.Stat(dst); err != nil {
				name, ok := byNFC[norm.NFC.String(a.DownloadedAs)]
				if !ok {
					if a.Status == "" || a.Status == "missing" {
						a.Status = "linked"
					}
					cfg.Log.Printf("%-24s %-6s not downloaded, link only: %s", d.Slug, a.Kind, a.Post)
					continue
				}
				if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
					return err
				}
				if err := moveOrCopy(filepath.Join(from, name), dst, copyFiles); err != nil {
					return err
				}
				cfg.Log.Printf("%-24s %-6s %s <- %s", d.Slug, a.Kind, filepath.Base(dst), name)
			}
			sum, err := fileSHA256(dst)
			if err != nil {
				return err
			}
			a.Status, a.SHA256 = "obtained", sum
		}
	}
	return nil
}

// Prepare builds the web media for one dance.
func Prepare(ctx context.Context, d *content.Source, cfg Config) (*content.Meta, error) {
	var video *content.Asset
	for i := range d.Assets {
		if d.Assets[i].Kind == "video" && d.Assets[i].Status == "obtained" {
			video = &d.Assets[i]
		}
	}
	if video == nil {
		return nil, fmt.Errorf("%s: tutorial video not obtained; run `bal import` first", d.Slug)
	}
	srcPath := filepath.Join(cfg.RawDir, d.Slug, norm.NFC.String(video.OriginalFilename))
	sp, err := ffprobe(ctx, srcPath)
	if err != nil {
		return nil, err
	}
	if sp.Video == nil {
		return nil, fmt.Errorf("%s: %s has no video stream", d.Slug, srcPath)
	}
	st, err := os.Stat(srcPath)
	if err != nil {
		return nil, err
	}
	version := video.SHA256[:12]
	outDir := filepath.Join(cfg.MediaDir, d.Slug)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return nil, err
	}

	m := &content.Meta{Slug: d.Slug, Version: version, PreparedAt: time.Now().UTC()}
	m.Video.Source.Filename = video.OriginalFilename
	m.Video.Source.SHA256 = video.SHA256
	m.Video.Source.Bytes = st.Size()
	m.Video.Source.Bitrate = sp.Bitrate
	m.Video.Source.Duration = sp.Duration
	m.Video.Source.Codec = sp.Video.Codec

	// 1. Browser MP4. Remuxed files keep the plain name; transcodes carry the encoder
	// generation too, because media URLs are cached as immutable: new bytes need a new URL.
	// (Notes and progress follow Version, the source hash, so they survive a re-encode.)
	mode := "remux"
	if !canRemux(sp) || !hasShortKeyframeGaps(ctx, srcPath, sp.Duration) {
		mode = "transcode"
	}
	videoName := "video-" + version + ".mp4"
	if mode == "transcode" {
		videoName = "video-" + version + "-" + EncodeGeneration + ".mp4"
	}
	videoPath := filepath.Join(outDir, videoName)
	if cfg.Force || !exists(videoPath) {
		cfg.Log.Printf("%s: %s %s (%dx%d %s, %.1f Mbit/s)", d.Slug, mode, video.OriginalFilename,
			sp.Video.Width, sp.Video.Height, sp.Video.FrameRate, float64(sp.Bitrate)/1e6)
		if err := buildVideo(ctx, srcPath, videoPath, sp, mode); err != nil {
			return nil, err
		}
	}
	// Keep older immutable video URLs available to players opened before a media update.
	vp, err := ffprobe(ctx, videoPath)
	if err != nil {
		return nil, err
	}
	if math.Abs(vp.Duration-sp.Duration) > 0.25 {
		return nil, fmt.Errorf("%s: output duration %.2fs differs from source %.2fs", d.Slug, vp.Duration, sp.Duration)
	}
	if ok, err := moovFirst(videoPath); err != nil || !ok {
		return nil, fmt.Errorf("%s: output is not fast-start (moov first=%v, err=%v)", d.Slug, ok, err)
	}
	vst, _ := os.Stat(videoPath)
	m.Video.Path = path.Join(d.Slug, videoName)
	m.Video.Duration = round2(vp.Duration)
	m.Video.Width, m.Video.Height = vp.Video.Width, vp.Video.Height
	m.Video.FPS = vp.Video.FrameRate
	m.Video.Bytes = vst.Size()
	m.Video.Bitrate = vp.Bitrate
	m.Video.Mode = mode
	if vp.Video.FrameRate != sp.Video.FrameRate || vp.Video.Width != sp.Video.Width {
		return nil, fmt.Errorf("%s: framing changed: %dx%d@%s -> %dx%d@%s", d.Slug,
			sp.Video.Width, sp.Video.Height, sp.Video.FrameRate, vp.Video.Width, vp.Video.Height, vp.Video.FrameRate)
	}

	// 2. Cover frame from the original (best quality).
	at := sp.Duration * 0.3
	if d.CoverAt != nil {
		at = *d.CoverAt
	} else {
		cfg.Log.Printf("%s: WARNING no coverAt in sources.json, using %.1fs; pick a real frame with `bal contact`", d.Slug, at)
	}
	m.Poster = content.PosterMeta{Path: path.Join(d.Slug, "poster.webp"), Small: path.Join(d.Slug, "poster-640.webp"), At: at}
	if err := frameWebP(ctx, srcPath, at, 1280, filepath.Join(outDir, "poster.webp"), 82); err != nil {
		return nil, err
	}
	if err := frameWebP(ctx, srcPath, at, 640, filepath.Join(outDir, "poster-640.webp"), 78); err != nil {
		return nil, err
	}
	// JPEG for link previews: some messengers ignore WebP og:image.
	if err := run(ctx, "ffmpeg", "-v", "error", "-y", "-ss", fmt.Sprintf("%.3f", at), "-i", srcPath, "-frames:v", "1",
		"-vf", "scale=1280:-2", "-q:v", "3", filepath.Join(outDir, "poster.jpg")); err != nil {
		return nil, err
	}

	// 3. Hover preview: 8 s muted loop from the cover frame, 480p, ≤ 30 fps.
	previewPath := filepath.Join(outDir, "preview.mp4")
	if cfg.Force || !exists(previewPath) {
		if err := buildPreview(ctx, srcPath, at, previewPath, sp); err != nil {
			return nil, err
		}
	}
	m.Preview = path.Join(d.Slug, "preview.mp4")

	// 4. Timeline sprites + WebVTT, from the prepared file.
	vtt, err := buildThumbnails(ctx, videoPath, outDir, d.Slug, vp, cfg.Force)
	if err != nil {
		return nil, err
	}
	m.Thumbnails = vtt

	// 5. Schemes and practice audio: copied untouched, verified by decoding.
	for _, a := range d.Assets {
		if a.Status != "obtained" || a.Kind == "video" {
			continue
		}
		in := filepath.Join(cfg.RawDir, d.Slug, norm.NFC.String(a.OriginalFilename))
		postID := path.Base(a.Post)
		if err := decodeCheck(ctx, in); err != nil {
			return nil, err
		}
		switch a.Kind {
		case "scheme":
			p, err := ffprobe(ctx, in)
			if err != nil {
				return nil, err
			}
			ext := strings.ToLower(filepath.Ext(in))
			rel := path.Join(d.Slug, "schemes", postID+ext)
			thumb := path.Join(d.Slug, "schemes", postID+"-480.webp")
			if err := copyFile(in, filepath.Join(cfg.MediaDir, rel)); err != nil {
				return nil, err
			}
			if err := run(ctx, "ffmpeg", "-v", "error", "-y", "-i", in, "-vf", "scale=480:-2",
				"-c:v", "libwebp", "-quality", "80", filepath.Join(cfg.MediaDir, thumb)); err != nil {
				return nil, err
			}
			m.Schemes = append(m.Schemes, content.SchemeMeta{Path: rel, Thumb: thumb,
				Width: p.Video.Width, Height: p.Video.Height, Post: a.Post})
		case "audio":
			p, err := ffprobe(ctx, in)
			if err != nil {
				return nil, err
			}
			ext := strings.ToLower(filepath.Ext(in))
			rel := path.Join(d.Slug, "audio", postID+ext)
			if err := copyFile(in, filepath.Join(cfg.MediaDir, rel)); err != nil {
				return nil, err
			}
			title := p.Tags["title"]
			if title == "" {
				title = strings.TrimSpace(strings.TrimSuffix(norm.NFC.String(a.OriginalFilename), filepath.Ext(a.OriginalFilename)))
			}
			m.Audio = append(m.Audio, content.AudioMeta{Path: rel, Title: title, Duration: round2(p.Duration),
				Post: a.Post, Original: a.OriginalFilename})
		}
	}

	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(outDir, "meta.json"), b, 0o644); err != nil {
		return nil, err
	}
	return m, nil
}

func canRemux(p *Probe) bool {
	v := p.Video
	audioOK := p.Audio == nil || p.Audio.Codec == "aac" || p.Audio.Codec == "mp3"
	return v.Codec == "h264" && v.PixFmt == "yuv420p" && audioOK && p.Bitrate > 0 && p.Bitrate <= MaxRemuxBitrate
}

// EncodeGeneration names the transcode settings below; bump it when they change.
//
// e2: x264 "slower" at CRF 22. Measured with VMAF against the camera originals it matches the
// first encode ("medium", CRF 21) within 0.3 points (95.6 vs 95.9, 96.7 vs 97.0), well under
// what anyone can see, at about 20% fewer bytes.
// e3 keeps the e2 settings and caps the distance between keyframes at two seconds.
const EncodeGeneration = "e3"

func buildVideo(ctx context.Context, in, out string, p *Probe, mode string) error {
	tmp := out + ".part.mp4"
	args := []string{"-v", "error", "-y", "-i", in, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1"}
	if mode == "remux" {
		args = append(args, "-c", "copy")
	} else {
		keyframes := int(math.Floor(SeekKeyframeSeconds * p.Video.FPS()))
		if keyframes < 1 {
			return fmt.Errorf("%s: invalid frame rate %q", in, p.Video.FrameRate)
		}
		maxrate := "5M"
		if p.Video.FPS() > 31 {
			maxrate = "7M"
		}
		args = append(args,
			"-c:v", "libx264", "-preset", "slower", "-crf", "22",
			"-maxrate", maxrate, "-bufsize", "10M", "-g", fmt.Sprint(keyframes),
			"-profile:v", "high", "-pix_fmt", "yuv420p",
			"-fps_mode", "passthrough", "-tag:v", "avc1")
		if p.Audio != nil && p.Audio.Codec == "aac" {
			args = append(args, "-c:a", "copy")
		} else {
			args = append(args, "-c:a", "aac", "-b:a", "160k")
		}
	}
	args = append(args, "-movflags", "+faststart", tmp)
	if err := run(ctx, "ffmpeg", args...); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, out)
}

const PreviewSeconds = 8

func buildPreview(ctx context.Context, in string, at float64, out string, p *Probe) error {
	start := math.Max(0, math.Min(at, p.Duration-PreviewSeconds))
	vf := "scale=480:-2"
	if p.Video.FPS() > 31 {
		vf += ",fps=25"
	}
	tmp := out + ".part.mp4"
	if err := run(ctx, "ffmpeg", "-v", "error", "-y", "-ss", fmt.Sprintf("%.3f", start), "-i", in,
		"-t", fmt.Sprint(PreviewSeconds), "-an", "-map_metadata", "-1", "-vf", vf,
		"-c:v", "libx264", "-preset", "slow", "-crf", "30", "-profile:v", "main", "-pix_fmt", "yuv420p",
		"-movflags", "+faststart", tmp); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, out)
}

func frameWebP(ctx context.Context, in string, at float64, width int, out string, quality int) error {
	return run(ctx, "ffmpeg", "-v", "error", "-y", "-ss", fmt.Sprintf("%.3f", at), "-i", in,
		"-frames:v", "1", "-vf", fmt.Sprintf("scale=%d:-2", width),
		"-c:v", "libwebp", "-quality", fmt.Sprint(quality), out)
}

func buildThumbnails(ctx context.Context, videoPath, outDir, slug string, p *Probe, force bool) (string, error) {
	tw := ThumbWidth
	th := int(math.Round(float64(tw)*float64(p.Video.Height)/float64(p.Video.Width)/2)) * 2
	n := int(math.Ceil(p.Duration / ThumbInterval))
	perSheet := SpriteCols * SpriteRows
	sheets := (n + perSheet - 1) / perSheet
	thumbDir := filepath.Join(outDir, "thumbs")
	vttPath := filepath.Join(outDir, "thumbs.vtt")

	if force || !exists(vttPath) || !exists(filepath.Join(thumbDir, fmt.Sprintf("sprite-%02d.webp", sheets))) {
		os.RemoveAll(thumbDir)
		if err := os.MkdirAll(thumbDir, 0o755); err != nil {
			return "", err
		}
		vf := fmt.Sprintf("fps=1/%g:round=down,scale=%d:%d,tile=%dx%d", ThumbInterval, tw, th, SpriteCols, SpriteRows)
		if err := run(ctx, "ffmpeg", "-v", "error", "-y", "-i", videoPath, "-an",
			"-vf", vf, "-start_number", "1", "-c:v", "libwebp", "-quality", "70",
			filepath.Join(thumbDir, "sprite-%02d.webp")); err != nil {
			return "", err
		}
	}
	got, _ := filepath.Glob(filepath.Join(thumbDir, "sprite-*.webp"))
	if len(got) != sheets {
		return "", fmt.Errorf("%s: expected %d sprite sheets, ffmpeg wrote %d", slug, sheets, len(got))
	}

	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	for i := 0; i < n; i++ {
		start := float64(i) * ThumbInterval
		end := math.Min(start+ThumbInterval, p.Duration)
		sheet := i/perSheet + 1
		cell := i % perSheet
		fmt.Fprintf(&b, "%s --> %s\n/media/%s/thumbs/sprite-%02d.webp#xywh=%d,%d,%d,%d\n\n",
			vttTime(start), vttTime(end), slug, sheet, (cell%SpriteCols)*tw, (cell/SpriteCols)*th, tw, th)
	}
	if err := os.WriteFile(vttPath, []byte(b.String()), 0o644); err != nil {
		return "", err
	}
	return path.Join(slug, "thumbs.vtt"), nil
}

// Contact writes a numbered contact sheet of frames (one every `every`
// seconds) so a person can pick the cover frame by eye.
func Contact(ctx context.Context, d *content.Source, cfg Config, every float64, out string) error {
	for _, a := range d.Assets {
		if a.Kind != "video" || a.Status != "obtained" {
			continue
		}
		in := filepath.Join(cfg.RawDir, d.Slug, norm.NFC.String(a.OriginalFilename))
		p, err := ffprobe(ctx, in)
		if err != nil {
			return err
		}
		n := int(math.Ceil(p.Duration / every))
		cols := 6
		rows := (n + cols - 1) / cols
		vf := fmt.Sprintf("fps=1/%g,scale=320:-2,drawtext=text='%%{eif\\:t\\:d}s':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6,tile=%dx%d",
			every, cols, rows)
		return run(ctx, "ffmpeg", "-v", "error", "-y", "-i", in, "-an", "-vf", vf, "-frames:v", "1", out)
	}
	return fmt.Errorf("%s: no obtained video", d.Slug)
}

func vttTime(s float64) string {
	ms := int64(math.Round(s * 1000))
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func removeStale(dir, prefix, suffix, keep string) {
	matches, _ := filepath.Glob(filepath.Join(dir, prefix+"*"+suffix))
	for _, m := range matches {
		if filepath.Base(m) != keep {
			os.Remove(m)
		}
	}
}

func fileSHA256(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func moveOrCopy(src, dst string, copyFiles bool) error {
	if !copyFiles {
		if err := os.Rename(src, dst); err == nil {
			return nil
		}
	}
	return copyFile(src, dst)
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}
