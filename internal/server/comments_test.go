package server

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"bal/internal/store"
)

func TestComments(t *testing.T) {
	ts := newTestServer(t)
	// A fake toxicity model: anything with "дурак" is an insult, "сомнительно" is borderline.
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Text string }
		json.NewDecoder(r.Body).Decode(&in)
		insult := 0.01
		if strings.Contains(in.Text, "дурак") {
			insult = 0.97
		} else if strings.Contains(in.Text, "сомнительно") {
			insult = 0.6
		}
		json.NewEncoder(w).Encode(map[string]any{"labels": map[string]float64{"insult": insult}})
	}))
	defer model.Close()
	lastServer.checker.URL = model.URL
	lastServer.cfg.Moderators = []string{"модератор"}

	anna, boris, mod, guest := newClient(t, ts), newClient(t, ts), newClient(t, ts), newClient(t, ts)
	anna.do("POST", "/api/auth/dev", `{"name":"Анна"}`)
	boris.do("POST", "/api/auth/dev", `{"name":"Борис"}`)
	mod.do("POST", "/api/auth/dev", `{"name":"Модератор"}`)

	// Live updates: a guest watching the page sees Anna's comment arrive.
	resp, err := guest.http.Get(ts.URL + "/api/dances/demo/events")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("events: %v %v", err, resp)
	}
	defer resp.Body.Close()
	lines := bufio.NewScanner(resp.Body)

	if code, _ := guest.do("POST", "/api/dances/demo/comments", `{"body":"привет"}`); code != 401 {
		t.Fatalf("guest posted: %d", code)
	}
	code, body := anna.do("POST", "/api/dances/demo/comments", `{"body":"На 1:20 поворот налево"}`)
	if code != 201 {
		t.Fatalf("create: %d %s", code, body)
	}
	var created struct{ Comment store.Comment }
	json.Unmarshal([]byte(body), &created)
	for lines.Scan() && !strings.HasPrefix(lines.Text(), `data: {"type":"comment"`) {
	}
	if !strings.Contains(lines.Text(), "поворот налево") {
		t.Fatalf("comment event: %s (%v)", lines.Text(), lines.Err())
	}

	if code, body := boris.do("POST", "/api/dances/demo/comments", `{"body":"бля, сложно"}`); code != 422 || !strings.Contains(body, "нецензурные") {
		t.Fatalf("obscene: %d %s", code, body)
	}
	if code, body := boris.do("POST", "/api/dances/demo/comments", `{"body":"ты дурак"}`); code != 422 || !strings.Contains(body, "оскорбление") {
		t.Fatalf("insult: %d %s", code, body)
	}
	code, body = boris.do("POST", "/api/dances/demo/comments", `{"body":"сомнительно, но ладно"}`)
	if code != 201 || !strings.Contains(body, `"held"`) || !strings.Contains(body, "на проверку") {
		t.Fatalf("held: %d %s", code, body)
	}
	var held struct{ Comment store.Comment }
	json.Unmarshal([]byte(body), &held)

	// The held comment is visible to its author and moderators only.
	if _, body := anna.do("GET", "/api/dances/demo/comments", ""); strings.Contains(body, "сомнительно") {
		t.Fatalf("anna sees held: %s", body)
	}
	if _, body := boris.do("GET", "/api/dances/demo/comments", ""); !strings.Contains(body, "сомнительно") {
		t.Fatalf("boris lost his held comment: %s", body)
	}
	if code, _ := anna.do("POST", "/api/comments/"+jsonNum(held.Comment.ID)+"/approve", ""); code != 403 && code != 404 {
		t.Fatalf("anna approved: %d", code)
	}
	if code, _ := mod.do("POST", "/api/comments/"+jsonNum(held.Comment.ID)+"/approve", ""); code != 200 {
		t.Fatalf("mod approve: %d", code)
	}
	if _, body := anna.do("GET", "/api/dances/demo/comments", ""); !strings.Contains(body, "сомнительно") {
		t.Fatalf("approved comment hidden: %s", body)
	}

	// Replies nest up to maxDepth; deeper ones join their parent's level.
	id := jsonNum(created.Comment.ID)
	parent := created.Comment.ID
	var chain []int64
	for i := 0; i < maxDepth+1; i++ {
		_, body = boris.do("POST", "/api/dances/demo/comments", `{"body":"ответ","parentId":`+jsonNum(parent)+`}`)
		var r struct{ Comment store.Comment }
		json.Unmarshal([]byte(body), &r)
		chain = append(chain, r.Comment.ParentID)
		parent = r.Comment.ID
	}
	if chain[1] == created.Comment.ID || chain[maxDepth] != chain[maxDepth-1] {
		t.Fatalf("reply parents %v (top %d)", chain, created.Comment.ID)
	}

	if code, body := boris.do("PUT", "/api/comments/"+id+"/like", `{"on":true}`); code != 200 || !strings.Contains(body, `"likes":1`) {
		t.Fatalf("like: %d %s", code, body)
	}
	if code, _ := boris.do("DELETE", "/api/comments/"+id, ""); code != 403 {
		t.Fatalf("boris deleted anna's comment: %d", code)
	}
	// A comment with replies stays as a placeholder: no text, no author; the replies stay.
	if code, body := anna.do("DELETE", "/api/comments/"+id, ""); code != 200 || !strings.Contains(body, `"deleted":true`) {
		t.Fatalf("anna delete: %d %s", code, body)
	}
	_, body = guest.do("GET", "/api/dances/demo/comments", "")
	if !strings.Contains(body, `"ответ"`) || strings.Contains(body, "поворот налево") || !strings.Contains(body, `"deleted":true`) {
		t.Fatalf("after soft delete: %s", body)
	}
	if code, _ := boris.do("POST", "/api/dances/demo/comments", `{"body":"ещё","parentId":`+id+`}`); code != 400 {
		t.Fatalf("reply to a deleted comment: %d", code)
	}
	// Deleting the reply chain from the bottom up removes the placeholder with the last reply.
	for i := len(chain) - 1; i >= 0; i-- {
		var list struct{ Comments []store.Comment }
		_, body := guest.do("GET", "/api/dances/demo/comments", "")
		json.Unmarshal([]byte(body), &list)
		var leaf int64
		for _, c := range list.Comments {
			if c.Body == "ответ" {
				hasChild := false
				for _, d := range list.Comments {
					if d.ParentID == c.ID {
						hasChild = true
					}
				}
				if !hasChild {
					leaf = c.ID
				}
			}
		}
		if leaf == 0 {
			break
		}
		if code, _ := boris.do("DELETE", "/api/comments/"+jsonNum(leaf), ""); code != 200 {
			t.Fatalf("delete reply: %d", code)
		}
	}
	if _, body := guest.do("GET", "/api/dances/demo/comments", ""); strings.Contains(body, `"ответ"`) || strings.Contains(body, `"deleted":true`) {
		t.Fatalf("placeholder or replies left: %s", body)
	}
}

func TestMentionsAndUsernames(t *testing.T) {
	ts := newTestServer(t)
	anna, boris := newClient(t, ts), newClient(t, ts)
	anna.do("POST", "/api/auth/dev", `{"name":"Анна Петрова"}`)
	boris.do("POST", "/api/auth/dev", `{"name":"Борис"}`)

	var me struct{ User store.User }
	_, body := anna.do("GET", "/api/me", "")
	json.Unmarshal([]byte(body), &me)
	if !strings.HasPrefix(me.User.Username, "annapetrova") {
		t.Fatalf("generated username %q", me.User.Username)
	}
	if code, _ := anna.do("PATCH", "/api/me", `{"username":"@Anna.Dance"}`); code != 200 {
		t.Fatalf("rename: %d", code)
	}
	if code, _ := boris.do("PATCH", "/api/me", `{"username":"anna.dance"}`); code != 409 {
		t.Fatalf("duplicate username: %d", code)
	}
	if code, _ := boris.do("PATCH", "/api/me", `{"username":"1x"}`); code != 400 {
		t.Fatalf("invalid username: %d", code)
	}

	// A comment by Anna, a reply by Boris that also mentions her: one notification.
	_, body = anna.do("POST", "/api/dances/demo/comments", `{"body":"Вопрос про 0:30"}`)
	var c struct{ Comment store.Comment }
	json.Unmarshal([]byte(body), &c)
	boris.do("POST", "/api/dances/demo/comments", `{"body":"@anna.dance смотри на 0:31","parentId":`+jsonNum(c.Comment.ID)+`}`)
	boris.do("POST", "/api/dances/demo/comments", `{"body":"Кстати, @Anna.Dance, спасибо"}`)
	_, body = anna.do("GET", "/api/notifications", "")
	var n struct {
		Items []struct {
			Kind       string
			DanceTitle string
		}
		Unread int
	}
	json.Unmarshal([]byte(body), &n)
	if n.Unread != 2 || len(n.Items) != 2 || n.Items[0].Kind != "mention" || n.Items[1].Kind != "reply" || n.Items[0].DanceTitle != "Демо" {
		t.Fatalf("notifications: %s", body)
	}
	anna.do("POST", "/api/notifications/read", "")
	if _, body := anna.do("GET", "/api/notifications", ""); !strings.Contains(body, `"unread":0`) {
		t.Fatalf("after read: %s", body)
	}
	if _, body := boris.do("GET", "/api/notifications", ""); !strings.Contains(body, `"items":[]`) {
		t.Fatalf("boris notified about himself: %s", body)
	}
}
