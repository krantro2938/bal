package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestAnalyticsOrigin(t *testing.T) {
	const id = "0c1d3e5f-1a2b-4c3d-8e9f-0123456789ab"
	for in, want := range map[string]string{
		"https://stats.coffer.rest":      "https://stats.coffer.rest",
		"https://stats.coffer.rest/":     "https://stats.coffer.rest",
		"http://127.0.0.1:3000":          "http://127.0.0.1:3000",
		"https://stats.example.com:8443": "https://stats.example.com:8443",
	} {
		if got, err := analyticsOrigin(in, id); err != nil || got != want {
			t.Errorf("analyticsOrigin(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"stats.coffer.rest", "ftp://stats.coffer.rest", "https://", "https://u:p@stats.coffer.rest",
		"https://stats.coffer.rest/umami", "https://stats.coffer.rest?x=1"} {
		if _, err := analyticsOrigin(in, id); err == nil {
			t.Errorf("analyticsOrigin(%q) accepted", in)
		}
	}
	if _, err := analyticsOrigin("https://stats.coffer.rest", "not-a-uuid"); err == nil {
		t.Error("a site ID that is not a UUID was accepted")
	}
	if _, err := analyticsOrigin("https://stats.coffer.rest", ""); err == nil {
		t.Error("a URL without a site ID was accepted")
	}
	if got, err := analyticsOrigin("", ""); got != "" || err != nil {
		t.Errorf("both empty = %q, %v; want off without an error", got, err)
	}
}

func TestPulseForwardsCheckedReports(t *testing.T) {
	got := make(chan *http.Request, 8)
	bodies := make(chan map[string]any, 8)
	umami := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		json.NewDecoder(r.Body).Decode(&b)
		got <- r
		bodies <- b
		w.Write([]byte(`{"cache":"x"}`))
	}))
	defer umami.Close()

	ts := newTestServer(t)
	s := lastServer
	s.cfg.AnalyticsSiteID = "0c1d3e5f-1a2b-4c3d-8e9f-0123456789ab"
	s.analyticsURL = umami.URL
	s.analyticsClient = umami.Client()
	s.publicHost = "example.test"
	s.pulses = newLimiter(1000, time.Millisecond)
	s.pulseSlots = make(chan struct{}, 4)

	post := func(body string) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/pulse", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "Mozilla/5.0 test")
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusNoContent {
			t.Fatalf("pulse answered %s", res.Status)
		}
	}

	post(`{"url":"/dance/demo","name":"play","language":"ru-RU","screen":"390x844",` +
		`"referrer":"https://t.me/some/post?secret=1#x"}`)
	select {
	case r := <-got:
		b := <-bodies
		if r.URL.Path != "/api/send" || r.Header.Get("User-Agent") != "Mozilla/5.0 test" || r.Header.Get("True-Client-IP") == "" {
			t.Fatalf("forwarded to %s with headers %v", r.URL.Path, r.Header)
		}
		p := b["payload"].(map[string]any)
		want := map[string]any{"website": s.cfg.AnalyticsSiteID, "hostname": "example.test", "url": "/dance/demo",
			"name": "play", "language": "ru-RU", "screen": "390x844", "referrer": "https://t.me/some/post"}
		if b["type"] != "event" || len(p) != len(want) {
			t.Fatalf("payload %v", b)
		}
		for k, v := range want {
			if p[k] != v {
				t.Errorf("payload[%s] = %v, want %v", k, p[k], v)
			}
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a valid report was not forwarded")
	}

	post(`{"url":"/dance/demo","name":"video-seek","data":{"ms":180,"frame":"presented","comment":"private"}}`)
	select {
	case <-got:
		p := (<-bodies)["payload"].(map[string]any)
		want := map[string]any{"ms": float64(180), "frame": "presented"}
		if p["name"] != "video-seek" || !reflect.DeepEqual(p["data"], want) {
			t.Fatalf("unexpected playback payload: %v", p)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("playback timing was not forwarded")
	}

	// Invalid playback data, unknown pages or events, and junk are dropped.
	for _, body := range []string{
		`{"url":"/dance/demo","name":"video-startup"}`,
		`{"url":"/dance/demo","name":"video-failure","data":{"phase":"seek","reason":"raw media error"}}`,
		`{"url":"/dance/demo","name":"video-seek","data":{"ms":15001,"frame":"presented"}}`,
		`{"url":"/dance/demo","name":"video-session","data":{"stalls":-1,"stall_ms":0}}`,
		`{"url":"/","name":"video-session","data":{"stalls":0,"stall_ms":0}}`,
		`{"url":"/dance/demo","name":"play","data":{"ms":100}}`,
		`{"url":"/dance/demo?t=5"}`,
		`{"url":"/admin"}`,
		`{"url":"/","name":"bought-a-car"}`,
		`not json`,
	} {
		post(body)
	}
	post(`{"url":"/","referrer":"http://example.test/me"}`)
	select {
	case <-got:
		b := <-bodies
		p := b["payload"].(map[string]any)
		if p["url"] != "/" || p["referrer"] != nil {
			t.Fatalf("expected only the home page view without a referrer, got %v", p)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("home page view was not forwarded")
	}
	select {
	case r := <-got:
		t.Fatalf("an invalid report reached Umami: %v", r.URL)
	case <-time.After(200 * time.Millisecond):
	}
}

func TestPulseOffDoesNothing(t *testing.T) {
	ts := newTestServer(t)
	res, err := ts.Client().Post(ts.URL+"/api/pulse", "application/json", strings.NewReader(`{"url":"/"}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("pulse with counting off answered %s", res.Status)
	}
}
