package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func sample(t *testing.T, name string, content []byte, corrupt bool) *zip.Reader {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	h := sha256.Sum256(content)
	hash := hex.EncodeToString(h[:])
	if corrupt {
		hash = "invalid"
	}
	m := manifest{"12.10.0-unico1", []entry{{name, hash, int64(len(content))}}}
	v, _ := json.Marshal(m)
	f, _ := z.Create("manifest.json")
	f.Write(v)
	f, _ = z.Create(name)
	f.Write(content)
	z.Close()
	reader, err := zip.NewReader(bytes.NewReader(b.Bytes()), int64(b.Len()))
	if err != nil {
		t.Fatal(err)
	}
	return reader
}
func TestPayload(t *testing.T) {
	for _, n := range []string{"../escape", "/escape", "C:/escape", "a\\b", "a/../b"} {
		if _, e := extract(sample(t, n, []byte("x"), false), t.TempDir()); e == nil {
			t.Fatal(n)
		}
	}
	if _, e := extract(sample(t, "a", []byte("x"), true), t.TempDir()); e == nil {
		t.Fatal("hash")
	}
	d := t.TempDir()
	if _, e := extract(sample(t, "sdk/Lib/test", []byte("x"), false), d); e != nil {
		t.Fatal(e)
	}
	if b, _ := os.ReadFile(filepath.Join(d, "sdk/Lib/test")); string(b) != "x" {
		t.Fatal("content")
	}
}
func TestInstallPreservesUnexpectedFiles(t *testing.T) {
	d := t.TempDir()
	s := filepath.Join(d, "source")
	v := filepath.Join(d, "target")
	os.WriteFile(s, []byte("new"), 0600)
	h := sha256.Sum256([]byte("new"))
	hash := hex.EncodeToString(h[:])
	if e := installFile(s, v, hash); e != nil {
		t.Fatal(e)
	}
	if e := installFile(s, v, hash); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(v, []byte("previous"), 0600)
	if e := installFile(s, v, hash); e == nil {
		t.Fatal("overwrite")
	}
	b, _ := os.ReadFile(v)
	if string(b) != "previous" {
		t.Fatal("preservation")
	}
}
func TestReadyRequiresReaderAndSDK(t *testing.T) {
	s := map[string]any{"ok": true, "sdk": true, "reader": true}
	if !ready(s) {
		t.Fatal("ready")
	}
	for _, key := range []string{"ok", "sdk", "reader"} {
		s[key] = false
		if ready(s) {
			t.Fatal(key)
		}
		s[key] = true
	}
	for _, key := range []string{"busy", "checking"} {
		s[key] = true
		if ready(s) {
			t.Fatal(key)
		}
		delete(s, key)
	}
}
func TestEveryKnownFailureHasAction(t *testing.T) {
	for _, c := range []string{"HVCI_DRIVER", "USB_ABSENT", "SDK_LOAD_FAILED", "JAVA_NOT_FOUND", "DRIVER_FAILED", "REBOOT_REQUIRED", "READER_BUSY", "SECURITY_UNKNOWN"} {
		if solution(c) == solution("unknown") {
			t.Fatal(c)
		}
	}
}

// Validate the actual generated archive, not only fixtures. build_ci.py creates
// it before invoking go test, so stale seed versions are rejected before release.
func TestActualReleasePayload(t *testing.T) {
	data, err := os.ReadFile("payload.zip")
	if os.IsNotExist(err) {
		t.Skip("release archive has not been generated")
	}
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	m, err := extract(reader, t.TempDir())
	if err != nil {
		t.Fatalf("generated release archive is invalid: %v", err)
	}
	if m.Version != "12.10.0-unico1" {
		t.Fatal("incorrect release version")
	}
}

func TestSDKFailureNeverReportsReady(t *testing.T) {
	for _, code := range []string{"NITGEN_15", "NITGEN_24", "SDK_NOT_FOUND", "INITIALIZING"} {
		if ready(map[string]any{"ok": true, "sdk": true, "reader": true, "errorCode": code}) {
			t.Fatal(code)
		}
	}
}
func TestRegisteredRuntimeKeepsEarlierSDK(t *testing.T) {
	local := t.TempDir()
	got := runtimeTarget(local, "amd64", "sdk/Bin/NBioBSP.dll")
	want := filepath.Join(local, "JP", "Biometria", "sdk-5.2.0.6-jp1", "Bin", "NBioBSP.dll")
	if got != want {
		t.Fatal(got)
	}
	if runtimeTarget(local, "amd64", "driver/FpUSB.inf") != "" {
		t.Fatal("driver is not copied as a private SDK file")
	}
}
