package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// rewrite sends requests for oauth.telegram.org to a local test server.
type rewrite struct{ target string }

func (r rewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	u := *req.URL
	t, _ := http.NewRequest(req.Method, r.target+u.Path, req.Body)
	t.Header = req.Header
	return http.DefaultTransport.RoundTrip(t)
}

func sign(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	head := enc(map[string]string{"alg": "RS256", "kid": kid, "typ": "JWT"})
	body := enc(claims)
	h := sha256.Sum256([]byte(head + "." + body))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, h[:])
	if err != nil {
		t.Fatal(err)
	}
	return head + "." + body + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestVerifyIDToken(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "kid": "k1",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	defer jwks.Close()
	tg := Google("123456", "secret", "https://example.test")
	tg.HTTP = &http.Client{Transport: rewrite{jwks.URL}}

	good := map[string]any{"iss": "https://accounts.google.com", "aud": "123456", "sub": "42", "exp": time.Now().Add(time.Hour).Unix(),
		"nonce": "n1", "name": "Анна", "preferred_username": "anna"}
	c, err := tg.Verify(context.Background(), sign(t, key, "k1", good), "n1")
	if err != nil || c.Sub != "42" || c.DisplayName() != "Анна" {
		t.Fatalf("valid token rejected: %v %+v", err, c)
	}

	mutate := func(k string, v any) map[string]any {
		m := map[string]any{}
		for kk, vv := range good {
			m[kk] = vv
		}
		m[k] = v
		return m
	}
	cases := map[string]string{
		"wrong aud":   sign(t, key, "k1", mutate("aud", "999")),
		"wrong iss":   sign(t, key, "k1", mutate("iss", "https://evil")),
		"expired":     sign(t, key, "k1", mutate("exp", time.Now().Add(-time.Hour).Unix())),
		"wrong nonce": sign(t, key, "k1", mutate("nonce", "other")),
		"wrong key":   sign(t, other, "k1", good),
		"tampered":    strings.Replace(sign(t, key, "k1", good), ".", ".e30", 1),
	}
	for name, tok := range cases {
		if _, err := tg.Verify(context.Background(), tok, "n1"); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestPKCEChallenge(t *testing.T) {
	// RFC 7636 appendix B example.
	if got := PKCEChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"); got != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatalf("got %s", got)
	}
}
