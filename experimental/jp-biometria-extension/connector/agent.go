package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const webOrigin = "https://www.jptreinamentos.com.br"
const maxAgentBody = 256 * 1024

type pingReply struct {
	OK         bool   `json:"ok"`
	Owned      bool   `json:"owned"`
	Version    string `json:"version"`
	BuildSHA   string `json:"buildSha"`
	InstanceID string `json:"instanceId"`
	Port       int    `json:"port"`
	Proof      string `json:"proof"`
}
type agentStatus struct {
	OK           bool   `json:"ok"`
	SDK          bool   `json:"sdk"`
	Reader       bool   `json:"reader"`
	DeviceCount  int    `json:"deviceCount"`
	Busy         bool   `json:"busy"`
	Checking     bool   `json:"checking"`
	ErrorCode    string `json:"errorCode"`
	Version      string `json:"version"`
	InstanceID   string `json:"instanceId"`
	Port         int    `json:"port"`
	Capabilities struct {
		Capture bool `json:"capture"`
	} `json:"capabilities"`
}
type captureReply struct {
	OK              bool   `json:"ok"`
	ErrorCode       string `json:"errorCode"`
	Code            string `json:"code"`
	RealFingerImage bool   `json:"realFingerImage"`
	Image           string `json:"fingerImageDataUrl"`
}

func client(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect denied") }}
}
func readJSON(resp *http.Response, target any) error {
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxAgentBody+1))
	if err != nil || len(b) > maxAgentBody {
		return errors.New("invalid agent response")
	}
	return json.Unmarshal(b, target)
}
func agentURL(port int, path string) string { return fmt.Sprintf("http://127.0.0.1:%d%s", port, path) }
func mac(key []byte, message string) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func readKey() ([]byte, error) {
	base := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(base) {
		return nil, errors.New("local app data missing")
	}
	f, err := os.Open(filepath.Join(base, "JP", "Biometria", "control.key"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 128))
	if err != nil {
		return nil, err
	}
	key, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(b)))
	if err != nil || len(key) != 32 {
		return nil, errors.New("invalid agent key")
	}
	return key, nil
}

func verifiedPing(ctx context.Context, c *http.Client, port int, key []byte) (pingReply, error) {
	var reply pingReply
	if port < 8789 || port > 8799 || len(key) != 32 {
		return reply, errors.New("invalid local target")
	}
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return reply, err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	const payload = `{"command":"ping"}`
	req, err := http.NewRequestWithContext(ctx, "POST", agentURL(port, "/control"), strings.NewReader(payload))
	if err != nil {
		return reply, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-JP-Control", "v1:"+stamp+":"+nonce+":"+mac(key, "/control\n"+stamp+"\n"+nonce+"\n"+payload))
	resp, err := c.Do(req)
	if err != nil {
		return reply, err
	}
	err = readJSON(resp, &reply)
	if err != nil || resp.StatusCode != 200 || !reply.OK || !reply.Owned || reply.Port != port || reply.InstanceID == "" || reply.Version == "" {
		return reply, errors.New("unverified agent")
	}
	expected := mac(key, "response\n"+stamp+"\n"+nonce+"\nping\n"+reply.InstanceID+"\n"+reply.Version+"\n"+strconv.Itoa(port)+"\n"+reply.BuildSHA)
	if !hmac.Equal([]byte(expected), []byte(reply.Proof)) {
		return reply, errors.New("unverified agent")
	}
	return reply, nil
}

func discover(key []byte) (pingReply, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 1800*time.Millisecond)
	defer cancel()
	ch := make(chan pingReply, 11)
	var wg sync.WaitGroup
	for port := 8789; port <= 8799; port++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			if reply, err := verifiedPing(ctx, client(1100*time.Millisecond), p, key); err == nil {
				ch <- reply
			}
		}(port)
	}
	go func() { wg.Wait(); close(ch) }()
	var found []pingReply
	for reply := range ch {
		found = append(found, reply)
	}
	if len(found) > 1 {
		return pingReply{}, errors.New("MULTIPLE_AGENTS")
	}
	if len(found) == 0 {
		return pingReply{}, errors.New("AGENT_OFFLINE")
	}
	return found[0], nil
}

func readiness(s agentStatus) string {
	if s.Busy {
		return "READER_BUSY"
	}
	if s.Checking {
		return "CHECKING"
	}
	if !s.SDK {
		if s.ErrorCode == "SDK_NOT_FOUND" {
			return "SDK_NOT_FOUND"
		}
		return "SDK_UNAVAILABLE"
	}
	if !s.Reader || s.DeviceCount < 1 {
		return "READER_NOT_READY"
	}
	if !s.OK || !s.Capabilities.Capture {
		return "AGENT_INCOMPATIBLE"
	}
	return "READY"
}

func fetchStatus(ctx context.Context, c *http.Client, agent pingReply) (agentStatus, error) {
	var s agentStatus
	req, _ := http.NewRequestWithContext(ctx, "GET", agentURL(agent.Port, "/status"), nil)
	resp, err := c.Do(req)
	if err != nil {
		return s, err
	}
	err = readJSON(resp, &s)
	if err != nil || resp.StatusCode != 200 || s.InstanceID != agent.InstanceID || s.Version != agent.Version || s.Port != agent.Port {
		return s, errors.New("agent changed")
	}
	return s, nil
}

func queryStatus(ctx context.Context, c *http.Client, agent pingReply) (agentStatus, error) {
	// The existing agent refreshes the SDK asynchronously. Brief bounded polling
	// avoids reporting a stale "checking" state after a completed refresh.
	for attempt := 0; ; attempt++ {
		s, err := fetchStatus(ctx, c, agent)
		if err != nil || !s.Checking || s.Busy || attempt >= 8 {
			return s, err
		}
		select {
		case <-ctx.Done():
			return s, nil
		case <-time.After(150 * time.Millisecond):
		}
	}
}

func validateImage(raw string) (int, int, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(raw, prefix) || len(raw) > 210000 {
		return 0, 0, errors.New("invalid image")
	}
	b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(raw, prefix))
	if err != nil || len(b) > 150*1024 {
		return 0, 0, errors.New("invalid image")
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(b))
	if err != nil || cfg.Width < 32 || cfg.Height < 32 || cfg.Width > 2048 || cfg.Height > 2048 {
		return 0, 0, errors.New("invalid image size")
	}
	// Validate the complete PNG, not only its header. Maximum dimensions limit allocation.
	if _, err = png.Decode(bytes.NewReader(b)); err != nil {
		return 0, 0, errors.New("invalid PNG")
	}
	return cfg.Width, cfg.Height, nil
}

func captureTest(c *http.Client, agent pingReply, finger string) Response {
	if !validFinger(finger) {
		return result("INVALID_REQUEST")
	}
	body, _ := json.Marshal(map[string]any{"cmd": "capture", "purpose": "test", "fingerCode": finger, "requireRealImage": true, "requireTemplate": false})
	req, _ := http.NewRequest("POST", agentURL(agent.Port, "/api/capture"), bytes.NewReader(body))
	req.Header.Set("Origin", webOrigin)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		return result("CAPTURE_TIMEOUT")
	}
	var reply captureReply
	if readJSON(resp, &reply) != nil {
		return result("CAPTURE_FAILED")
	}
	if resp.StatusCode != 200 || !reply.OK {
		code := reply.ErrorCode
		if code == "" {
			code = reply.Code
		}
		switch code {
		case "READER_BUSY", "CAPTURE_TIMEOUT", "SDK_NOT_FOUND", "READER_NOT_READY":
			return result(code)
		}
		return result("CAPTURE_FAILED")
	}
	w, h, err := validateImage(reply.Image)
	if !reply.RealFingerImage || err != nil {
		return result("IMAGE_MISSING")
	}
	r := result("CAPTURE_OK")
	r.Image = reply.Image
	r.Width = w
	r.Height = h
	r.AgentVersion = agent.Version
	r.Port = agent.Port
	return r
}

func handle(req Request) Response {
	if !validRequest(req) {
		return result("INVALID_REQUEST")
	}
	key, err := readKey()
	if err != nil {
		return result("AGENT_SETUP_REQUIRED")
	}
	defer func() {
		for i := range key {
			key[i] = 0
		}
	}()
	agent, err := discover(key)
	if err != nil {
		return result(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2200*time.Millisecond)
	defer cancel()
	status, err := queryStatus(ctx, client(2*time.Second), agent)
	if err != nil {
		return result("AGENT_CHANGED")
	}
	r := result(readiness(status))
	r.AgentVersion = agent.Version
	r.Port = agent.Port
	if req.Action == "captureTest" && r.OK {
		return captureTest(client(25*time.Second), agent, req.Finger)
	}
	return r
}
