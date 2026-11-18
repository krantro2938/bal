// Package moderation decides what happens to a comment before anyone sees it:
// a word filter for мат, then a small toxicity model (the sidecar in /moderation).
package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Status string

const (
	Published Status = "published"
	Held      Status = "held"     // visible to its author and moderators until approved
	Rejected  Status = "rejected" // never stored; the author is told why
)

type Verdict struct {
	Status Status
	Reason string  // for the author when rejected or held
	Score  float64 // highest model label score, 0 without the model
}

// Checker scores comments. URL is the sidecar's base URL; empty means the word filter only.
type Checker struct {
	URL    string
	Client *http.Client
}

// Thresholds on the model's per-label probabilities. Its overall "toxicity" is noisy
// («Чёрт, опять сбилась» scores 0.75), while the insult label separates cleanly:
// insults score above 0.9 and ordinary rehearsal talk below 0.06.
const (
	rejectInsult = 0.9
	holdInsult   = 0.5
	holdThreat   = 0.5
	holdDanger   = 0.8
)

func (c *Checker) Check(ctx context.Context, text string) Verdict {
	if Obscene(text) {
		return Verdict{Status: Rejected, Reason: "Комментарий не опубликован: уберите нецензурные слова."}
	}
	if c.URL == "" {
		return Verdict{Status: Published}
	}
	labels, err := c.score(ctx, text)
	if err != nil {
		// The filter already passed; a model outage should not stop the discussion.
		return Verdict{Status: Published, Score: -1}
	}
	top := max(labels.Insult, labels.Obscenity, labels.Threat, labels.Dangerous)
	switch {
	case labels.Insult >= rejectInsult || labels.Obscenity >= rejectInsult:
		return Verdict{Status: Rejected, Score: top, Reason: "Комментарий похож на оскорбление и не опубликован. Пожалуйста, пишите уважительно."}
	case labels.Insult >= holdInsult || labels.Threat >= holdThreat || labels.Dangerous >= holdDanger:
		return Verdict{Status: Held, Score: top, Reason: "Комментарий отправлен на проверку организаторам."}
	}
	return Verdict{Status: Published, Score: top}
}

type labels struct {
	Insult    float64 `json:"insult"`
	Obscenity float64 `json:"obscenity"`
	Threat    float64 `json:"threat"`
	Dangerous float64 `json:"dangerous"`
}

func (c *Checker) score(ctx context.Context, text string) (labels, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+"/score", bytes.NewReader(body))
	if err != nil {
		return labels{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := c.Client
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return labels{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return labels{}, fmt.Errorf("moderation: status %d", res.StatusCode)
	}
	var out struct {
		Labels labels `json:"labels"`
	}
	return out.Labels, json.NewDecoder(res.Body).Decode(&out)
}
