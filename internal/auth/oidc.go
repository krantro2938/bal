// Package auth signs people in with Google (OpenID Connect, Authorization Code
// flow with PKCE) and with email and password.
//
// Google: in Google Cloud Console → APIs & Services → Credentials create an
// OAuth client ID of type "Web application" with the authorized redirect URI
// <origin>/auth/google/callback, and set BAL_GOOGLE_CLIENT_ID /
// BAL_GOOGLE_CLIENT_SECRET.
package auth

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

// Provider is one OpenID Connect identity provider.
type Provider struct {
	Name          string // "google": also the user_accounts key
	ClientID      string
	ClientSecret  string
	RedirectURL   string
	AuthEndpoint  string
	TokenEndpoint string
	JWKSEndpoint  string
	Issuers       []string
	Scope         string
	ExtraAuth     map[string]string // extra authorization request parameters
	BasicAuth     bool              // client_secret_basic instead of client_secret_post
	HTTP          *http.Client

	mu      sync.Mutex
	keys    map[string]crypto.PublicKey
	fetched time.Time
}

func Google(clientID, secret, publicURL string) *Provider {
	return &Provider{
		Name: "google", ClientID: clientID, ClientSecret: secret,
		RedirectURL:   strings.TrimRight(publicURL, "/") + "/auth/google/callback",
		AuthEndpoint:  "https://accounts.google.com/o/oauth2/v2/auth",
		TokenEndpoint: "https://oauth2.googleapis.com/token",
		JWKSEndpoint:  "https://www.googleapis.com/oauth2/v3/certs",
		Issuers:       []string{"https://accounts.google.com", "accounts.google.com"},
		Scope:         "openid email profile",
		ExtraAuth:     map[string]string{"prompt": "select_account"},
	}
}

type Claims struct {
	Sub               string `json:"sub"`
	Email             string `json:"email"`
	EmailVerified     any    `json:"email_verified"` // bool, or "true" from some providers
	ID                any    `json:"id"`
	Name              string `json:"name"`
	GivenName         string `json:"given_name"`
	FamilyName        string `json:"family_name"`
	PreferredUsername string `json:"preferred_username"`
	Picture           string `json:"picture"`
	Nonce             string `json:"nonce"`
	Iss               string `json:"iss"`
	Aud               any    `json:"aud"`
	Exp               int64  `json:"exp"`
}

func (c *Claims) DisplayName() string {
	if c.Name != "" {
		return c.Name
	}
	if n := strings.TrimSpace(c.GivenName + " " + c.FamilyName); n != "" {
		return n
	}
	if c.PreferredUsername != "" {
		return "@" + c.PreferredUsername
	}
	return "Участник"
}

func (c *Claims) VerifiedEmail() bool {
	switch v := c.EmailVerified.(type) {
	case bool:
		return v && c.Email != ""
	case string:
		return v == "true" && c.Email != ""
	}
	return false
}

// PKCEChallenge returns the S256 code challenge for a verifier.
func PKCEChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func (t *Provider) AuthURL(state, verifier, nonce string) string {
	q := url.Values{
		"client_id":             {t.ClientID},
		"redirect_uri":          {t.RedirectURL},
		"response_type":         {"code"},
		"scope":                 {t.Scope},
		"state":                 {state},
		"nonce":                 {nonce},
		"code_challenge":        {PKCEChallenge(verifier)},
		"code_challenge_method": {"S256"},
	}
	for k, v := range t.ExtraAuth {
		q.Set(k, v)
	}
	return t.AuthEndpoint + "?" + q.Encode()
}

// Exchange trades the authorization code for a verified ID token's claims.
func (t *Provider) Exchange(ctx context.Context, code, verifier, nonce string) (*Claims, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {t.RedirectURL},
		"client_id":     {t.ClientID},
		"code_verifier": {verifier},
	}
	if !t.BasicAuth {
		form.Set("client_secret", t.ClientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if t.BasicAuth {
		req.SetBasicAuth(t.ClientID, t.ClientSecret)
	}
	resp, err := t.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var tok struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
		Desc    string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return nil, fmt.Errorf("token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK || tok.IDToken == "" {
		return nil, fmt.Errorf("token endpoint: %d %s %s", resp.StatusCode, tok.Error, tok.Desc)
	}
	return t.Verify(ctx, tok.IDToken, nonce)
}

// Verify checks the ID token signature against the provider's JWKS and its
// iss/aud/exp/nonce claims.
func (t *Provider) Verify(ctx context.Context, idToken, nonce string) (*Claims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed id_token")
	}
	var hdr struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := decodeSegment(parts[0], &hdr); err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, err
	}
	key, err := t.key(ctx, hdr.Kid)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	switch hdr.Alg {
	case "RS256":
		pub, ok := key.(*rsa.PublicKey)
		if !ok || rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig) != nil {
			return nil, errors.New("id_token signature invalid")
		}
	case "ES256":
		pub, ok := key.(*ecdsa.PublicKey)
		if !ok || len(sig) != 64 || !ecdsa.Verify(pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
			return nil, errors.New("id_token signature invalid")
		}
	default:
		return nil, fmt.Errorf("unsupported id_token alg %q (use RS256)", hdr.Alg)
	}
	var c Claims
	if err := decodeSegment(parts[1], &c); err != nil {
		return nil, err
	}
	if !slices.Contains(t.Issuers, c.Iss) {
		return nil, fmt.Errorf("unexpected issuer %q", c.Iss)
	}
	if !audContains(c.Aud, t.ClientID) {
		return nil, errors.New("id_token audience mismatch")
	}
	if time.Now().Unix() > c.Exp+30 {
		return nil, errors.New("id_token expired")
	}
	if nonce != "" && c.Nonce != nonce {
		return nil, errors.New("id_token nonce mismatch")
	}
	if c.Sub == "" {
		return nil, errors.New("id_token without sub")
	}
	return &c, nil
}

func audContains(aud any, want string) bool {
	switch v := aud.(type) {
	case string:
		return v == want
	case float64:
		return fmt.Sprintf("%.0f", v) == want
	case []any:
		for _, a := range v {
			if audContains(a, want) {
				return true
			}
		}
	}
	return false
}

func (t *Provider) key(ctx context.Context, kid string) (crypto.PublicKey, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if k, ok := t.keys[kid]; ok && time.Since(t.fetched) < 6*time.Hour {
		return k, nil
	}
	if time.Since(t.fetched) < 10*time.Second && t.keys != nil {
		return nil, fmt.Errorf("unknown signing key %q", kid)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, t.JWKSEndpoint, nil)
	resp, err := t.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
			Crv string `json:"crv"`
			X   string `json:"x"`
			Y   string `json:"y"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, fmt.Errorf("jwks: %w", err)
	}
	keys := map[string]crypto.PublicKey{}
	for _, k := range set.Keys {
		switch k.Kty {
		case "RSA":
			n, err1 := base64.RawURLEncoding.DecodeString(k.N)
			e, err2 := base64.RawURLEncoding.DecodeString(k.E)
			if err1 != nil || err2 != nil {
				continue
			}
			keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
		case "EC":
			if k.Crv != "P-256" {
				continue
			}
			x, err1 := base64.RawURLEncoding.DecodeString(k.X)
			y, err2 := base64.RawURLEncoding.DecodeString(k.Y)
			if err1 != nil || err2 != nil {
				continue
			}
			keys[k.Kid] = &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
		}
	}
	t.keys, t.fetched = keys, time.Now()
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown signing key %q", kid)
}

func (t *Provider) client() *http.Client {
	if t.HTTP != nil {
		return t.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func decodeSegment(seg string, v any) error {
	b, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
