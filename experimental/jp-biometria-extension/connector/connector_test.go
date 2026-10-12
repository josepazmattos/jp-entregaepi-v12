package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func replyHTTP(status int, v any) *http.Response {
	b, _ := json.Marshal(v)
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(b))}
}
func testImage() string {
	var b bytes.Buffer
	png.Encode(&b, image.NewGray(image.Rect(0, 0, 64, 80)))
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}
func frame(v string) []byte {
	var b bytes.Buffer
	binary.Write(&b, binary.LittleEndian, uint32(len(v)))
	b.WriteString(v)
	return b.Bytes()
}

func TestNativeProtocol(t *testing.T) {
	for _, test := range []struct {
		name, body, code string
		calls            int
	}{
		{"status", `{"action":"status"}`, "READY", 1},
		{"capture", `{"action":"captureTest","finger":"R_INDEX"}`, "READY", 1},
		{"certificate", `{"action":"certificate"}`, "INVALID_REQUEST", 0},
		{"shutdown", `{"action":"shutdown"}`, "INVALID_REQUEST", 0},
		{"enroll", `{"action":"enroll"}`, "INVALID_REQUEST", 0},
		{"arbitraryURL", `{"action":"status","url":"https://example.com"}`, "INVALID_REQUEST", 0},
		{"arbitraryRoute", `{"action":"status","path":"/api/certificate/sign"}`, "INVALID_REQUEST", 0},
		{"badFinger", `{"action":"captureTest","finger":"X_INDEX"}`, "INVALID_REQUEST", 0},
		{"missingFinger", `{"action":"captureTest"}`, "INVALID_REQUEST", 0},
		{"trailingJSON", `{"action":"status"}{}`, "INVALID_REQUEST", 0},
		{"brokenJSON", `{`, "INVALID_REQUEST", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			var out bytes.Buffer
			calls := 0
			if err := serve(bytes.NewReader(frame(test.body)), &out, func(Request) Response { calls++; return result("READY") }); err != nil {
				t.Fatal(err)
			}
			var n uint32
			binary.Read(&out, binary.LittleEndian, &n)
			var r Response
			json.Unmarshal(out.Bytes(), &r)
			if int(n) != out.Len() || r.Code != test.code || calls != test.calls {
				t.Fatalf("bad response: %s calls=%d", r.Code, calls)
			}
		})
	}
}
func TestBadFrames(t *testing.T) {
	for _, n := range []uint32{0, maxRequest + 1, 0xffffffff} {
		var in, out bytes.Buffer
		binary.Write(&in, binary.LittleEndian, n)
		if serve(&in, &out, func(Request) Response { t.Fatal("called handler"); return Response{} }) == nil {
			t.Fatal("accepted oversized frame")
		}
	}
	if serve(bytes.NewReader([]byte{5, 0, 0, 0, 123}), io.Discard, func(Request) Response { return Response{} }) == nil {
		t.Fatal("accepted truncated frame")
	}
}
func TestCaller(t *testing.T) {
	good := "chrome-extension://" + extensionID + "/"
	for _, args := range [][]string{{good}, {good, "--parent-window=0"}} {
		if !validCaller(args) {
			t.Fatal("rejected Chrome caller")
		}
	}
	for _, args := range [][]string{nil, {}, {"https://www.jptreinamentos.com.br"}, {good + "fake"}, {good, "--install"}, {good, "--parent-window=-1"}, {good, "--parent-window=0", "--install"}} {
		if validCaller(args) {
			t.Fatal("accepted unexpected caller")
		}
	}
}
func TestReadiness(t *testing.T) {
	base := agentStatus{OK: true, SDK: true, Reader: true, DeviceCount: 1}
	base.Capabilities.Capture = true
	if readiness(base) != "READY" {
		t.Fatal("ready rejected")
	}
	for _, tc := range []struct {
		name   string
		change func(*agentStatus)
	}{
		{"READER_BUSY", func(s *agentStatus) { s.Busy = true }}, {"CHECKING", func(s *agentStatus) { s.Checking = true }},
		{"SDK_NOT_FOUND", func(s *agentStatus) { s.SDK = false; s.ErrorCode = "SDK_NOT_FOUND" }}, {"SDK_UNAVAILABLE", func(s *agentStatus) { s.SDK = false }},
		{"READER_NOT_READY", func(s *agentStatus) { s.DeviceCount = 0 }}, {"READER_NOT_READY", func(s *agentStatus) { s.Reader = false }},
		{"AGENT_INCOMPATIBLE", func(s *agentStatus) { s.Capabilities.Capture = false }}, {"AGENT_INCOMPATIBLE", func(s *agentStatus) { s.OK = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := base
			tc.change(&s)
			if readiness(s) != tc.name {
				t.Fatal(readiness(s))
			}
		})
	}
}
func TestControlProof(t *testing.T) {
	key := bytes.Repeat([]byte{42}, 32)
	for _, tamper := range []bool{false, true} {
		c := &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(req.Body)
			if req.URL.Host != "127.0.0.1:8789" || req.URL.Path != "/control" || string(body) != `{"command":"ping"}` || req.Header.Get("Origin") != "" {
				t.Fatal("unexpected request")
			}
			a := strings.Split(req.Header.Get("X-JP-Control"), ":")
			if len(a) != 4 || a[3] != mac(key, "/control\n"+a[1]+"\n"+a[2]+"\n"+string(body)) {
				t.Fatal("bad request auth")
			}
			r := pingReply{OK: true, Owned: true, Version: "12.10.0-bio2", InstanceID: "test", Port: 8789, BuildSHA: "test"}
			r.Proof = mac(key, "response\n"+a[1]+"\n"+a[2]+"\nping\ntest\n12.10.0-bio2\n8789\ntest")
			if tamper {
				r.Proof += "tamper"
			}
			return replyHTTP(200, r), nil
		})}
		_, err := verifiedPing(context.Background(), c, 8789, key)
		if (err != nil) != tamper {
			t.Fatal("proof validation failed")
		}
	}
	if _, err := verifiedPing(context.Background(), client(time.Second), 80, key); err == nil {
		t.Fatal("accepted forbidden port")
	}
}
func TestStatusIdentity(t *testing.T) {
	agent := pingReply{InstanceID: "trusted", Version: "12.10.0-bio2", Port: 8789}
	c := &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		return replyHTTP(200, map[string]any{"instanceId": "other", "version": agent.Version, "port": agent.Port}), nil
	})}
	if _, err := queryStatus(context.Background(), c, agent); err == nil {
		t.Fatal("agent identity changed")
	}
}

func TestStatusAsyncRefresh(t *testing.T) {
	agent := pingReply{InstanceID: "trusted", Version: "12.10.0-bio2", Port: 8789}
	calls := 0
	c := &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return replyHTTP(200, map[string]any{"instanceId": "trusted", "version": agent.Version, "port": agent.Port, "checking": calls == 1}), nil
	})}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	s, err := queryStatus(ctx, c, agent)
	if err != nil || s.Checking || calls != 2 {
		t.Fatal("async status was not resolved", err, calls)
	}
}
func TestCaptureContract(t *testing.T) {
	for _, tc := range []struct {
		name   string
		body   map[string]any
		status int
		code   string
	}{
		{"image", map[string]any{"ok": true, "realFingerImage": true, "fingerImageDataUrl": testImage(), "template": "SECRET_TEMPLATE", "certificate": "SECRET_CERT"}, 200, "CAPTURE_OK"},
		{"imageMissing", map[string]any{"ok": true, "realFingerImage": true}, 200, "IMAGE_MISSING"},
		{"notReal", map[string]any{"ok": true, "realFingerImage": false, "fingerImageDataUrl": testImage()}, 200, "IMAGE_MISSING"},
		{"busy", map[string]any{"ok": false, "code": "READER_BUSY"}, 409, "READER_BUSY"},
		{"unknown", map[string]any{"ok": false, "code": "PRIVATE_ERROR", "message": "sensitive"}, 500, "CAPTURE_FAILED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			c := &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				var body map[string]any
				json.NewDecoder(req.Body).Decode(&body)
				if req.Method != "POST" || req.URL.Path != "/api/capture" || req.URL.Host != "127.0.0.1:8789" || req.Header.Get("Origin") != webOrigin || body["purpose"] != "test" || body["requireTemplate"] != false || body["fingerCode"] != "R_INDEX" {
					t.Fatal("unsafe capture contract")
				}
				return replyHTTP(tc.status, tc.body), nil
			})}
			r := captureTest(c, pingReply{Port: 8789}, "R_INDEX")
			b, _ := json.Marshal(r)
			if r.Code != tc.code || calls != 1 || bytes.Contains(b, []byte("SECRET")) {
				t.Fatalf("wrong capture output %s", r.Code)
			}
		})
	}
}
func TestInvalidImages(t *testing.T) {
	for _, s := range []string{"", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA", testImage()[:70], "data:image/png;base64," + strings.Repeat("A", 210001)} {
		if _, _, err := validateImage(s); err == nil {
			t.Fatal("accepted invalid image")
		}
	}
	if w, h, err := validateImage(testImage()); err != nil || w != 64 || h != 80 {
		t.Fatal("valid PNG rejected")
	}
}
func TestReadKey(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)
	if _, err := readKey(); err == nil {
		t.Fatal("missing accepted")
	}
	os.MkdirAll(filepath.Join(dir, "JP", "Biometria"), 0700)
	path := filepath.Join(dir, "JP", "Biometria", "control.key")
	os.WriteFile(path, []byte(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))), 0600)
	if key, err := readKey(); err != nil || len(key) != 32 {
		t.Fatal("valid key rejected")
	}
	os.WriteFile(path, []byte(strings.Repeat("A", 200)), 0600)
	if _, err := readKey(); err == nil {
		t.Fatal("oversized accepted")
	}
}
func TestHTTPBoundaries(t *testing.T) {
	r := &http.Response{Body: io.NopCloser(strings.NewReader(strings.Repeat("A", maxAgentBody+1)))}
	if readJSON(r, new(any)) == nil {
		t.Fatal("oversized agent response")
	}
	c := client(time.Second)
	if c.Transport.(*http.Transport).Proxy != nil || c.CheckRedirect(nil, nil) == nil {
		t.Fatal("proxy/redirect allowed")
	}
}

func TestEndToEndWithSimulatedAgent(t *testing.T) {
	// A synthetic local fixture, never a hardware test or a real fingerprint.
	listener, err := net.Listen("tcp", "127.0.0.1:8789")
	if err != nil {
		t.Fatal("test port unavailable", err)
	}
	key := bytes.Repeat([]byte{8}, 32)
	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)
	os.MkdirAll(filepath.Join(dir, "JP", "Biometria"), 0700)
	os.WriteFile(filepath.Join(dir, "JP", "Biometria", "control.key"), []byte(base64.RawURLEncoding.EncodeToString(key)), 0600)
	var mu sync.Mutex
	paths := []string{}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/control":
			body, _ := io.ReadAll(r.Body)
			a := strings.Split(r.Header.Get("X-JP-Control"), ":")
			if len(a) != 4 || string(body) != `{"command":"ping"}` || a[3] != mac(key, "/control\n"+a[1]+"\n"+a[2]+"\n"+string(body)) {
				w.WriteHeader(403)
				return
			}
			proof := mac(key, "response\n"+a[1]+"\n"+a[2]+"\nping\nsimulated\n12.10.0-bio2\n8789\ntest")
			json.NewEncoder(w).Encode(pingReply{OK: true, Owned: true, Version: "12.10.0-bio2", InstanceID: "simulated", Port: 8789, BuildSHA: "test", Proof: proof})
		case "/status":
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "sdk": true, "reader": true, "deviceCount": 1, "instanceId": "simulated", "version": "12.10.0-bio2", "port": 8789, "capabilities": map[string]bool{"capture": true, "certificates": true}, "biometricPublicKey": "MUST_NOT_LEAK"})
		case "/api/capture":
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "realFingerImage": true, "fingerImageDataUrl": testImage(), "template": "MUST_NOT_LEAK"})
		default:
			w.WriteHeader(403)
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	start := time.Now()
	r := handle(Request{Action: "status"})
	elapsed := time.Since(start)
	if r.Code != "READY" || elapsed > 3*time.Second {
		t.Fatalf("status %s in %s", r.Code, elapsed)
	}
	r = handle(Request{Action: "captureTest", Finger: "L_THUMB"})
	if r.Code != "CAPTURE_OK" {
		t.Fatal(r.Code)
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), "MUST_NOT_LEAK") {
		t.Fatal("secret leaked")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(paths) != 5 {
		t.Fatal("unexpected number of requests", strconv.Itoa(len(paths)))
	}
	t.Logf("Authenticated local discovery + status: %s (simulated agent)", elapsed)
}
