package server

import (
	"crypto/ecdh"
	"encoding/base64"
	"testing"
)

// The example message of RFC 8291, appendix A.
func TestEncryptPushRFC8291(t *testing.T) {
	b64 := func(s string) []byte {
		b, err := base64.RawURLEncoding.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	as, err := ecdh.P256().NewPrivateKey(b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := encryptPushWith(
		b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
		b64("BTBZMqHH6r4Tts7J_aSIgg"),
		[]byte("When I grow up, I want to be a watermelon"),
		as,
		b64("DGv6ra1nlYgDCS1FRnbzlw"),
	)
	if err != nil {
		t.Fatal(err)
	}
	want := "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	if g := base64.RawURLEncoding.EncodeToString(got); g != want {
		t.Fatalf("encrypted\n got %s\nwant %s", g, want)
	}
}

func TestValidPushEndpoint(t *testing.T) {
	for endpoint, ok := range map[string]bool{
		"https://fcm.googleapis.com/fcm/send/abc":            true,
		"https://web.push.apple.com/QGx":                     true,
		"https://updates.push.services.mozilla.com/wpush/v2": true,
		"http://fcm.googleapis.com/fcm/send/abc":             false,
		"https://evil.example/fcm.googleapis.com":            false,
		"https://fcm.googleapis.com.evil.example/x":          false,
		"https://127.0.0.1/x":                                false,
		"https://fcm.googleapis.com:8443/x":                  false,
	} {
		if validPushEndpoint(endpoint) != ok {
			t.Errorf("%s: want %v", endpoint, ok)
		}
	}
}
