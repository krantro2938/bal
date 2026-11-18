package prepare

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

type Probe struct {
	Duration float64
	Bitrate  int64
	Video    *Stream
	Audio    *Stream
	Tags     map[string]string
}

type Stream struct {
	Codec     string
	Profile   string
	PixFmt    string
	Width     int
	Height    int
	FrameRate string
	Bitrate   int64
}

func (s *Stream) FPS() float64 {
	if s == nil {
		return 0
	}
	num, den, ok := strings.Cut(s.FrameRate, "/")
	n, _ := strconv.ParseFloat(num, 64)
	if !ok {
		return n
	}
	d, _ := strconv.ParseFloat(den, 64)
	if d == 0 {
		return 0
	}
	return n / d
}

func ffprobe(ctx context.Context, path string) (*Probe, error) {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-print_format", "json",
		"-show_format", "-show_streams", path).Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe %s: %w", path, stderrOf(err))
	}
	var raw struct {
		Format struct {
			Duration string            `json:"duration"`
			BitRate  string            `json:"bit_rate"`
			Tags     map[string]string `json:"tags"`
		} `json:"format"`
		Streams []struct {
			CodecType   string `json:"codec_type"`
			CodecName   string `json:"codec_name"`
			Profile     string `json:"profile"`
			PixFmt      string `json:"pix_fmt"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
			RFrameRate  string `json:"r_frame_rate"`
			BitRate     string `json:"bit_rate"`
			Disposition struct {
				AttachedPic int `json:"attached_pic"`
			} `json:"disposition"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, err
	}
	p := &Probe{Tags: map[string]string{}}
	p.Duration, _ = strconv.ParseFloat(raw.Format.Duration, 64)
	p.Bitrate, _ = strconv.ParseInt(raw.Format.BitRate, 10, 64)
	for k, v := range raw.Format.Tags {
		p.Tags[strings.ToLower(k)] = v
	}
	for _, s := range raw.Streams {
		st := &Stream{Codec: s.CodecName, Profile: s.Profile, PixFmt: s.PixFmt, Width: s.Width,
			Height: s.Height, FrameRate: s.RFrameRate}
		st.Bitrate, _ = strconv.ParseInt(s.BitRate, 10, 64)
		switch {
		case s.CodecType == "video" && s.Disposition.AttachedPic == 0 && p.Video == nil:
			p.Video = st
		case s.CodecType == "audio" && p.Audio == nil:
			p.Audio = st
		}
	}
	return p, nil
}

// decodeCheck fully decodes a file and fails on any decoder error.
func decodeCheck(ctx context.Context, path string) error {
	cmd := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-xerror", "-i", path, "-f", "null", "-")
	var buf bytes.Buffer
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil || strings.TrimSpace(buf.String()) != "" {
		return fmt.Errorf("decode %s: %v %s", path, err, strings.TrimSpace(buf.String()))
	}
	return nil
}

// moovFirst reports whether the MP4's moov atom precedes mdat (fast start).
func moovFirst(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	var off int64
	hdr := make([]byte, 16)
	for {
		if _, err := f.ReadAt(hdr[:8], off); err != nil {
			if err == io.EOF {
				return false, fmt.Errorf("no moov/mdat atom")
			}
			return false, err
		}
		size := int64(binary.BigEndian.Uint32(hdr[:4]))
		typ := string(hdr[4:8])
		if size == 1 {
			if _, err := f.ReadAt(hdr[8:16], off+8); err != nil {
				return false, err
			}
			size = int64(binary.BigEndian.Uint64(hdr[8:16]))
		}
		switch typ {
		case "moov":
			return true, nil
		case "mdat":
			return false, nil
		}
		if size < 8 {
			return false, fmt.Errorf("bad atom %q at %d", typ, off)
		}
		off += size
	}
}

func run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	var buf bytes.Buffer
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s: %w\n%s", name, strings.Join(args, " "), err, tail(buf.String(), 2000))
	}
	return nil
}

func stderrOf(err error) error {
	if ee, ok := err.(*exec.ExitError); ok {
		return fmt.Errorf("%w: %s", err, tail(string(ee.Stderr), 500))
	}
	return err
}

func tail(s string, n int) string {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}
