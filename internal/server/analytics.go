package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Visit counting through a self-hosted Umami (optional, BAL_ANALYTICS_URL + BAL_ANALYTICS_SITE_ID).
//
// The browser never talks to Umami and loads none of its code: web/src/lib/analytics.ts POSTs a
// small report to /api/pulse on this origin, and the server checks it and passes it on. So the
// content security policy stays 'self', ad blockers that block Umami's host and script don't drop
// the counts, and the Umami website ID never reaches the page. Only a known page, a known event
// name and a few browser facts get through; anything else is dropped. Forwarding happens in the
// background with a short timeout, so a slow or missing Umami never slows the site down.

// analyticsEvents is every event that exists; keep in step with EVENTS in web/src/lib/analytics.ts.
var analyticsEvents = map[string]bool{
	"play":              true, // a dance video started playing (once per page view)
	"video-startup":     true,
	"video-open":        true,
	"video-seek":        true,
	"video-failure":     true,
	"video-session":     true,
	"finished":          true, // it was watched to the end (once per page view)
	"loop":              true, // a fragment repeat was turned on
	"slowed":            true, // playback speed set below 1×
	"scheme-opened":     true, // a scheme page was opened
	"mini-player":       true, // the dance went on in the mini player
	"timestamp-opened":  true, // a timestamp link was opened
	"comment-timestamp": true, // a timestamp in a comment was clicked
	"note-saved":        true, // a new private note
	"comment":           true, // a comment or reply was posted
	"reaction":          true, // like or dislike
	"favorite":          true, // saved to favorites
	"learned":           true, // marked as learned
	"share":             true, // a link was shared or copied
	"signup":            true, // an account was created
	"login":             true, // signed in with email and password
	"install":           true, // installed as an app
	"push-on":           true, // turned on notifications on a device
}

var (
	analyticsSiteID   = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	analyticsDance    = regexp.MustCompile(`^/dance/[a-z0-9-]{1,64}$`)
	analyticsLanguage = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$`)
	analyticsScreen   = regexp.MustCompile(`^[0-9]{1,5}x[0-9]{1,5}$`)
	analyticsPages    = map[string]bool{"/": true, "/login": true, "/register": true, "/me": true}
)

// analyticsOrigin checks BAL_ANALYTICS_URL and BAL_ANALYTICS_SITE_ID and returns the Umami origin.
func analyticsOrigin(rawURL, siteID string) (string, error) {
	if rawURL == "" && siteID == "" {
		return "", nil
	}
	if rawURL == "" || siteID == "" {
		return "", errors.New("BAL_ANALYTICS_URL and BAL_ANALYTICS_SITE_ID must both be set")
	}
	if !analyticsSiteID.MatchString(siteID) {
		return "", errors.New("BAL_ANALYTICS_SITE_ID must be the website's UUID in Umami")
	}
	u, err := url.Parse(strings.TrimRight(rawURL, "/"))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("BAL_ANALYTICS_URL must be an origin such as https://stats.example.com")
	}
	return u.Scheme + "://" + u.Host, nil
}

type pulse struct {
	URL      string          `json:"url"`
	Name     string          `json:"name,omitempty"`
	Referrer string          `json:"referrer,omitempty"`
	Language string          `json:"language,omitempty"`
	Screen   string          `json:"screen,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
}

// playbackData forwards only bounded timing values and fixed labels to Umami.
func playbackData(name string, raw json.RawMessage) (map[string]any, bool) {
	var d struct {
		MS      *int   `json:"ms"`
		Frame   string `json:"frame"`
		Entry   string `json:"entry"`
		Phase   string `json:"phase"`
		Reason  string `json:"reason"`
		Stalls  *int   `json:"stalls"`
		StallMS *int   `json:"stall_ms"`
	}
	if !strings.HasPrefix(name, "video-") {
		return nil, len(raw) == 0
	}
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, false
	}
	bounded := func(n *int, max int) bool { return n != nil && *n >= 0 && *n <= max }
	switch name {
	case "video-open":
		if bounded(d.MS, 30000) && (d.Frame == "presented" || d.Frame == "ready") && (d.Entry == "catalog" || d.Entry == "recommendation") {
			return map[string]any{"ms": *d.MS, "frame": d.Frame, "entry": d.Entry}, true
		}
	case "video-startup", "video-seek":
		if bounded(d.MS, 15000) && (d.Frame == "presented" || d.Frame == "ready") {
			return map[string]any{"ms": *d.MS, "frame": d.Frame}, true
		}
	case "video-failure":
		if (d.Phase == "startup" || d.Phase == "seek" || d.Phase == "playback") && (d.Reason == "error" || d.Reason == "timeout") {
			return map[string]any{"phase": d.Phase, "reason": d.Reason}, true
		}
	case "video-session":
		if bounded(d.Stalls, 100) && bounded(d.StallMS, 600000) {
			return map[string]any{"stalls": *d.Stalls, "stall_ms": *d.StallMS}, true
		}
	}
	return nil, false
}

// umamiPayload checks a report from the page and turns it into Umami's /api/send payload,
// or returns nil if any part of it is not something we count.
func (s *Server) umamiPayload(p pulse) map[string]any {
	if !analyticsPages[p.URL] && !analyticsDance.MatchString(p.URL) {
		return nil
	}
	if p.Name != "" && !analyticsEvents[p.Name] {
		return nil
	}
	data, ok := playbackData(p.Name, p.Data)
	if !ok || (data != nil && !analyticsDance.MatchString(p.URL)) {
		return nil
	}
	out := map[string]any{"website": s.cfg.AnalyticsSiteID, "hostname": s.publicHost, "url": p.URL}
	if p.Name != "" {
		out["name"] = p.Name
	}
	if data != nil {
		out["data"] = data
	}
	if analyticsLanguage.MatchString(p.Language) {
		out["language"] = p.Language
	}
	if analyticsScreen.MatchString(p.Screen) {
		out["screen"] = p.Screen
	}
	// An external site only, origin and path: no query or fragment.
	if p.Referrer != "" && len(p.Referrer) <= 512 {
		if u, err := url.Parse(p.Referrer); err == nil && (u.Scheme == "https" || u.Scheme == "http") &&
			u.Host != "" && u.User == nil && u.Hostname() != s.publicHost {
			out["referrer"] = u.Scheme + "://" + u.Host + u.EscapedPath()
		}
	}
	return out
}

// handlePulse always answers 204 at once; a valid report is passed on to Umami in the background.
func (s *Server) handlePulse(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
	if s.analyticsURL == "" {
		return
	}
	ua, ip, lang := r.UserAgent(), s.clientIP(r), r.Header.Get("Accept-Language")
	if ua == "" || !s.pulses.allow(ip) {
		return
	}
	var p pulse
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&p); err != nil {
		return
	}
	payload := s.umamiPayload(p)
	if payload == nil {
		return
	}
	body, err := json.Marshal(map[string]any{"type": "event", "payload": payload})
	if err != nil {
		return
	}
	select {
	case s.pulseSlots <- struct{}{}:
	default:
		return // Umami is slow and enough reports are already waiting: drop this one
	}
	go func() {
		defer func() { <-s.pulseSlots }()
		req, err := http.NewRequest(http.MethodPost, s.analyticsURL+"/api/send", bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		// Umami derives the browser, device and an anonymous daily visitor hash from these; it
		// keeps no address. True-Client-IP comes first in the headers Umami reads, so a proxy in
		// front of Umami that sets X-Forwarded-For or X-Real-IP doesn't turn every visitor into us.
		req.Header.Set("User-Agent", ua)
		req.Header.Set("True-Client-IP", ip)
		req.Header.Set("X-Forwarded-For", ip)
		if len(lang) <= 256 {
			req.Header.Set("Accept-Language", lang)
		}
		res, err := s.analyticsClient.Do(req)
		if err != nil {
			return
		}
		io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		res.Body.Close()
	}()
}

func newAnalyticsClient() *http.Client {
	return &http.Client{Timeout: 5 * time.Second}
}
