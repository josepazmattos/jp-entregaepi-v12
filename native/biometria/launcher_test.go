package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testKey() string { return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)) }

func TestEnvironmentReplacesEveryWindowsPathVariant(t *testing.T) {
	env := environmentWith([]string{"Path=old", "PATH=older", "keep=value", "pAtH=other"}, "PATH", `C:\SDK x64;C:\Windows`)
	want := []string{"keep=value", `PATH=C:\SDK x64;C:\Windows`}
	if !reflect.DeepEqual(env, want) {
		t.Fatalf("PATH must have one authoritative value: %#v", env)
	}
}
func TestProtocolAndRegistryQuoting(t *testing.T) {
	for _, input := range []string{"jpbiometria://start", "jpbiometria://start?ts=12", "jpbiometria://start/"} {
		if !validStartURI(input) {
			t.Fatalf("valid start URI rejected: %s", input)
		}
	}
	for _, input := range []string{"https://start", "jpbiometria://shutdown", "jpbiometria://start/run", "jpbiometria://person@start", "jpbiometria://start#code", "jpbiometria://start:123"} {
		if validStartURI(input) {
			t.Fatalf("invalid start URI accepted: %s", input)
		}
	}
	path := `C:\Users\Test Person\AppData\Local\JP\Biometria\JPBiometria.exe`
	operations := registryOperations(path)
	if len(operations) != 4 {
		t.Fatal("protocol and startup operations missing")
	}
	for _, args := range operations {
		if args[0] != "ADD" || !strings.HasPrefix(args[1], `HKCU\`) {
			t.Fatalf("registry writes must be user-scoped: %v", args)
		}
	}
	if operations[2][6] != `"`+path+`" --start "%1"` {
		t.Fatalf("protocol must preserve spaces and literal URL placeholder: %v", operations[2])
	}
	if operations[3][7] != `"`+path+`" --start` {
		t.Fatalf("startup must quote executable once: %v", operations[3])
	}
}
func TestExplicitInstallModes(t *testing.T) {
	for _, item := range []struct {
		args []string
		mode string
	}{{nil, "install"}, {[]string{"--install-quiet"}, "install-quiet"}, {[]string{"--start"}, "start"}, {[]string{"--start", "jpbiometria://start?ts=1"}, "start"}} {
		mode, err := parseMode(item.args)
		if err != nil || mode != item.mode {
			t.Errorf("parse %v: %s %v", item.args, mode, err)
		}
	}
	for _, args := range [][]string{{"--install-quiet", "extra"}, {"--start", "jpbiometria://shutdown"}, {"--unknown"}, {"--start", "jpbiometria://start", "extra"}} {
		if _, err := parseMode(args); err == nil {
			t.Errorf("unexpected mode allowed: %v", args)
		}
	}
}
func TestJavaVersionAndArchitecture(t *testing.T) {
	tests := []struct {
		text, arch string
		major      int
		valid      bool
	}{
		{"os.arch = x86\njava.specification.version = 1.8", "x86", 8, true},
		{"os.arch = amd64\njava.specification.version = 17", "amd64", 17, true},
		{"os.arch = x86_64\njava.specification.version = 21", "amd64", 21, true},
		{"os.arch = aarch64\njava.specification.version = 17", "", 0, false},
		{"os.arch = x86\njava.specification.version = 1.7", "", 0, false},
		{"openjdk version 17", "", 0, false},
	}
	for _, test := range tests {
		got, err := javaProperties(test.text)
		if (err == nil) != test.valid || test.valid && (got.Arch != test.arch || got.Major != test.major) {
			t.Errorf("parse %#v: %#v, %v", test, got, err)
		}
	}
}
func TestRuntimeSelectionNeverMixesArchitecture(t *testing.T) {
	sdk := []sdkLocation{{"SDK", "SDK/Bin/x64", "amd64"}, {"SDK", "SDK/Bin", "x86"}}
	x86 := javaRuntime{"jre32/bin/java.exe", "x86", 8}
	x64 := javaRuntime{"jdk64/bin/java.exe", "amd64", 17}
	got := selectRuntime(sdk, "", []javaRuntime{x86})
	if got.Java.Path != x86.Path || got.SDK.Arch != "x86" || got.Problem != "" {
		t.Fatalf("32-bit installed Java must use 32-bit SDK: %#v", got)
	}
	got = selectRuntime(sdk[:1], "", []javaRuntime{x86})
	if got.Problem != "JAVA_ARCH_MISMATCH" || got.Java.Path != "" {
		t.Fatalf("cannot launch wrong architecture: %#v", got)
	}
	got = selectRuntime(sdk, "", []javaRuntime{x64, x86})
	if got.Java.Arch != got.SDK.Arch || got.Problem != "" {
		t.Fatalf("matching architecture required: %#v", got)
	}
	got = selectRuntime(nil, "SDK_NOT_FOUND", []javaRuntime{x86})
	if got.Java.Path != x86.Path || got.Problem != "SDK_NOT_FOUND" {
		t.Fatalf("available Java should serve missing-SDK diagnostic: %#v", got)
	}
	got = selectRuntime(sdk, "", nil)
	if got.Problem != "JAVA_NOT_FOUND" {
		t.Fatalf("missing Java diagnostic: %#v", got)
	}
}
func writePE(t *testing.T, path string, machine uint16) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	data := make([]byte, 512)
	copy(data, "MZ")
	binary.LittleEndian.PutUint32(data[0x3c:], 0x80)
	copy(data[0x80:], "PE\x00\x00")
	binary.LittleEndian.PutUint16(data[0x84:], machine)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}
func TestSDKDiscoveryRequiresJarAndConsistentDLLs(t *testing.T) {
	root := filepath.Join(t.TempDir(), "NITGEN SDK with spaces")
	if err := os.MkdirAll(filepath.Join(root, "Lib"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Lib", "NBioBSPJNI.jar"), []byte("test-only placeholder"), 0600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "Bin")
	writePE(t, filepath.Join(bin, "NBioBSP.dll"), 0x14c)
	writePE(t, filepath.Join(bin, "NBioBSPJNI.dll"), 0x14c)
	got, problem := discoverSDK([]string{root})
	if problem != "" || len(got) != 1 || got[0].Arch != "x86" || got[0].Bin != bin {
		t.Fatalf("complete SDK not detected: %#v %s", got, problem)
	}
	writePE(t, filepath.Join(bin, "NBioBSPJNI.dll"), 0x8664)
	got, problem = discoverSDK([]string{root})
	if len(got) != 0 || problem != "SDK_ARCH_MISMATCH" {
		t.Fatalf("mixed DLLs accepted: %#v %s", got, problem)
	}
	os.Remove(filepath.Join(root, "Lib", "NBioBSPJNI.jar"))
	got, problem = discoverSDK([]string{root})
	if len(got) != 0 || problem != "SDK_NOT_FOUND" {
		t.Fatalf("driver alone is not the Java SDK: %#v %s", got, problem)
	}
}
func TestJavaArgumentsPreservePathsWithoutShell(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Test Person", "JP Biometria")
	selected := runtimeSelection{Java: javaRuntime{Path: "Java", Arch: "x86", Major: 8}, SDK: sdkLocation{Root: `C:\NITGEN SDK`, Bin: `C:\NITGEN SDK\Bin`, Arch: "x86"}}
	args := javaArguments(dir, 8790, selected)
	if args[0] != "-Djp.control.file="+filepath.Join(dir, "control.key") {
		t.Fatal("control path not passed as a single argument")
	}
	if args[len(args)-2] != filepath.Join(dir, jarName)+";"+filepath.Join(selected.SDK.Root, "Lib", "NBioBSPJNI.jar") {
		t.Fatalf("classpath mismatch: %v", args)
	}
	for _, arg := range args {
		if strings.Contains(arg, testKey()) {
			t.Fatal("control key must never be a process argument")
		}
	}
}
func TestKeyPersistenceAndAtomicFiles(t *testing.T) {
	dir := t.TempDir()
	key, err := loadOrCreateKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !keyPattern.MatchString(key) {
		t.Fatal("control key must contain 32 random bytes")
	}
	again, err := loadOrCreateKey(dir)
	if err != nil || again != key {
		t.Fatal("repair must preserve identity key")
	}
	path := filepath.Join(dir, "agent.jar")
	if err := writeAtomic(path, []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeAtomic(path, []byte("second"), 0600); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "second" {
		t.Fatal("atomic replacement failed")
	}
	if err := os.WriteFile(filepath.Join(dir, "control.key"), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOrCreateKey(dir); err == nil {
		t.Fatal("malformed key must not silently replace agent identity")
	}
}
func recorderRequest(d *diagnosticServer, method, path, origin string, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, localURL(d.port, path), strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:12345"
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	d.ServeHTTP(w, r)
	return w
}
func TestDiagnosticOnlyHTTPBoundaries(t *testing.T) {
	d, err := newDiagnosticServer(8789, testKey(), "JAVA_NOT_FOUND")
	if err != nil {
		t.Fatal(err)
	}
	origin := "https://www.jptreinamentos.com.br"
	status := recorderRequest(d, "GET", "/status", origin, "")
	if status.Code != 200 || !strings.Contains(status.Body.String(), `"capture":false`) || !strings.Contains(status.Body.String(), `"errorCode":"JAVA_NOT_FOUND"`) {
		t.Fatalf("diagnostic must be explicit: %s", status.Body.String())
	}
	if status.Header().Get("Access-Control-Allow-Origin") != origin || status.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("restricted CORS and no-store required")
	}
	for _, origin := range []string{"null", "https://evil.example", "https://www.jptreinamentos.com.br.evil.example", "http://127.0.0.1:8790"} {
		if got := recorderRequest(d, "GET", "/status", origin, ""); got.Code != 403 || got.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("unsafe origin %s accepted", origin)
		}
	}
	for _, item := range []struct {
		method, path, origin string
		code                 int
	}{{"GET", "/api/capture", origin, 405}, {"POST", "/api/capture", "", 403}, {"POST", "/api/capture", origin, 503}, {"POST", "/api/signature", origin, 501}, {"GET", "/shutdown", origin, 404}, {"GET", "/introspect", origin, 404}, {"POST", "/control", origin, 403}, {"POST", "/status", origin, 405}} {
		if got := recorderRequest(d, item.method, item.path, item.origin, "{}"); got.Code != item.code {
			t.Errorf("%s %s: %d want %d", item.method, item.path, got.Code, item.code)
		}
	}
	r := httptest.NewRequest("GET", localURL(d.port, "/status"), nil)
	r.RemoteAddr = "192.0.2.1:443"
	w := httptest.NewRecorder()
	d.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("remote peer accepted")
	}
	r.RemoteAddr = "127.0.0.1:12345"
	r.Host = "evil.example:8789"
	w = httptest.NewRecorder()
	d.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("rebinding Host accepted")
	}
	r = httptest.NewRequest("OPTIONS", localURL(d.port, "/api/capture"), nil)
	r.RemoteAddr = "127.0.0.1:12345"
	r.Header.Set("Origin", origin)
	r.Header.Set("Access-Control-Request-Method", "POST")
	r.Header.Set("Access-Control-Request-Headers", "Content-Type")
	r.Header.Set("Access-Control-Request-Private-Network", "true")
	w = httptest.NewRecorder()
	d.ServeHTTP(w, r)
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Private-Network") != "true" {
		t.Fatal("authorized preflight failed")
	}
	r.Header.Set("Access-Control-Request-Headers", "X-JP-Control")
	w = httptest.NewRecorder()
	d.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("control header exposed to browser")
	}
}
func startDiagnosticTest(t *testing.T) (*diagnosticServer, int) {
	t.Helper()
	port, err := availablePort()
	if err != nil {
		t.Fatal(err)
	}
	d, err := newDiagnosticServer(port, testKey(), "JAVA_NOT_FOUND")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", d.server.Addr)
	if err != nil {
		t.Fatal(err)
	}
	go d.server.Serve(listener)
	t.Cleanup(func() { d.server.Close() })
	return d, port
}
func TestAuthenticatedControlHandshakeAndSafeStop(t *testing.T) {
	d, port := startDiagnosticTest(t)
	owned, err := controlAt(port, testKey(), "ping")
	if err != nil || !owned.Owned || owned.Version != version {
		t.Fatalf("authenticated ownership failed: %#v %v", owned, err)
	}
	wrong := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32))
	if _, err := controlAt(port, wrong, "ping"); err == nil {
		t.Fatal("wrong key established ownership")
	}
	status, err := readStatus(port)
	if err != nil || status["runtime"] != "diagnostic-only" {
		t.Fatalf("diagnostic status unavailable: %v", err)
	}
	if err := stopOwned(port, testKey()); err != nil {
		t.Fatal(err)
	}
	connection, err := net.DialTimeout("tcp", d.server.Addr, 100*time.Millisecond)
	if err == nil {
		connection.Close()
		t.Fatal("owned agent not stopped")
	}
}
func TestControlMACFreshnessReplayAndNoRawKey(t *testing.T) {
	d, _ := newDiagnosticServer(8789, testKey(), "JAVA_NOT_FOUND")
	body := `{"command":"ping"}`
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "AAAAAAAAAAAAAAAAAAAAAA"
	header := "v1:" + stamp + ":" + nonce + ":" + requestMAC(testKey(), "/control\n"+stamp+"\n"+nonce+"\n"+body)
	if strings.Contains(header, testKey()) {
		t.Fatal("raw private key transmitted")
	}
	if _, ok := d.validControl(header, body); !ok {
		t.Fatal("fresh MAC rejected")
	}
	if _, ok := d.validControl(header, body); ok {
		t.Fatal("replayed MAC accepted")
	}
	stamp = strconv.FormatInt(time.Now().Unix()-120, 10)
	nonce = "BBBBBBBBBBBBBBBBBBBBBB"
	header = "v1:" + stamp + ":" + nonce + ":" + requestMAC(testKey(), "/control\n"+stamp+"\n"+nonce+"\n"+body)
	if _, ok := d.validControl(header, body); ok {
		t.Fatal("expired MAC accepted")
	}
	if _, ok := d.validControl(testKey(), body); ok {
		t.Fatal("raw control key accepted as network credential")
	}
}
func TestForeignListenerCannotFakeOwnershipOrBeStopped(t *testing.T) {
	port, err := availablePort()
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatal(err)
	}
	var shutdowns atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
		if strings.Contains(string(body), "shutdown") {
			shutdowns.Add(1)
		}
		json.NewEncoder(w).Encode(controlResponse{OK: true, Owned: true, Version: version, BuildSHA: buildSHA, InstanceID: "unowned", Port: port, Proof: "invalid"})
	})}
	go server.Serve(listener)
	defer server.Close()
	if _, err := controlAt(port, testKey(), "ping"); err == nil {
		t.Fatal("forged ownership response accepted")
	}
	if err := stopOwned(port, testKey()); err == nil {
		t.Fatal("unowned listener stopped")
	}
	if shutdowns.Load() != 0 {
		t.Fatal("shutdown must never be sent to unproven listener")
	}
	free, err := availablePort()
	if err != nil || free == port {
		t.Fatal("occupied legacy port must be skipped without killing")
	}
	if connection, err := net.DialTimeout("tcp", listener.Addr().String(), 200*time.Millisecond); err != nil {
		t.Fatal("foreign listener was affected")
	} else {
		connection.Close()
	}
}
func TestLocalHTTPNeverFollowsRedirects(t *testing.T) {
	var accessed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { accessed.Add(1) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer source.Close()
	if _, err := localClient(time.Second).Get(source.URL); err == nil {
		t.Fatal("local client followed redirect")
	}
	if accessed.Load() != 0 {
		t.Fatal("redirect target contacted")
	}
}
func TestDiagnosticSafeClose(t *testing.T) {
	d, _ := startDiagnosticTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := d.server.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
}
