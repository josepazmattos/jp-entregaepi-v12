package main

// A small fallback keeps diagnostics available even when Java cannot start.
// It cannot open the reader, return an image, or perform biometric matching.
import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type diagnosticServer struct {
	port                   int
	key, problem, instance string
	server                 *http.Server
	nonces                 map[string]int64
	mutex                  sync.Mutex
}

func newDiagnosticServer(port int, key, problem string) (*diagnosticServer, error) {
	if port < firstPort || port > lastPort || !keyPattern.MatchString(key) {
		return nil, errors.New("invalid local diagnostic configuration")
	}
	if _, ok := runtimeMessages[problem]; !ok {
		return nil, errors.New("invalid runtime problem")
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return nil, err
	}
	d := &diagnosticServer{port: port, key: key, problem: problem, instance: base64.RawURLEncoding.EncodeToString(random), nonces: map[string]int64{}}
	d.server = &http.Server{Addr: "127.0.0.1:" + strconv.Itoa(port), Handler: d, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 16384}
	return d, nil
}

var runtimeMessages = map[string]string{
	"JAVA_NOT_FOUND":     "Java 8 ou posterior não localizado. Instale ou selecione o Java da mesma arquitetura do SDK NITGEN e execute novamente o reparador. O driver do leitor foi preservado.",
	"JAVA_ARCH_MISMATCH": "O Java encontrado e o SDK NITGEN possuem arquiteturas diferentes. Use Java compatível com as bibliotecas do SDK e execute novamente o reparador.",
	"SDK_ARCH_MISMATCH":  "As bibliotecas NITGEN possuem arquiteturas diferentes entre si. Verifique o SDK instalado.",
	"SDK_NOT_FOUND":      "O SDK eNBioBSP com o componente Java não foi localizado. O driver do leitor foi preservado.",
	"SDK_DLL_NOT_FOUND":  "O componente Java do SDK foi localizado, mas as bibliotecas NITGEN necessárias não estão disponíveis.",
}

func runDiagnosticArgs(args []string) error {
	if err := requireWindows(); err != nil {
		return err
	}
	if len(args) != 4 || args[0] != "--port" || args[2] != "--problem" {
		return errors.New("invalid diagnostic arguments")
	}
	port, err := strconv.Atoi(args[1])
	if err != nil {
		return err
	}
	dir, err := installDirectory()
	if err != nil {
		return err
	}
	key, err := readControlKey(dir)
	if err != nil {
		return err
	}
	d, err := newDiagnosticServer(port, key, args[3])
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", d.server.Addr)
	if err != nil {
		return err
	}
	if err := d.server.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
func (d *diagnosticServer) allowedOrigin(origin string) bool {
	return allowedWebOrigins[origin] || origin == localURL(d.port, "") || origin == "http://localhost:"+strconv.Itoa(d.port)
}
func (d *diagnosticServer) headers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	if origin := r.Header.Get("Origin"); origin != "" && d.allowedOrigin(origin) && r.URL.Path != "/control" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-JP-EntregaEPI")
		if r.Method == "OPTIONS" && r.Header.Get("Access-Control-Request-Private-Network") == "true" {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
	}
}
func (d *diagnosticServer) json(w http.ResponseWriter, r *http.Request, code int, body any) {
	d.headers(w, r)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(body)
}
func (d *diagnosticServer) fail(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	d.json(w, r, status, map[string]any{"ok": false, "version": version, "errorCode": code, "message": message})
}
func (d *diagnosticServer) status() map[string]any {
	return map[string]any{"ok": false, "sdk": false, "reader": false, "deviceCount": 0, "version": version, "service": "JP Biometria Local", "agent": "JPBiometria", "buildSha": buildSHA,
		"instanceId": d.instance, "port": d.port, "busy": false, "checking": false, "errorCode": d.problem, "message": runtimeMessages[d.problem], "runtime": "diagnostic-only",
		"capabilities": map[string]any{"capture": false, "captureMethod": "POST", "capturePath": "/api/capture", "templates": false, "verify": false}}
}
func (d *diagnosticServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || net.ParseIP(remote) == nil || !net.ParseIP(remote).IsLoopback() || r.Host != "127.0.0.1:"+strconv.Itoa(d.port) && r.Host != "localhost:"+strconv.Itoa(d.port) {
		d.fail(w, r, 403, "HOST_NOT_ALLOWED", "Destino local não permitido.")
		return
	}
	if r.URL.Path == "/control" {
		d.control(w, r)
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && !d.allowedOrigin(origin) {
		d.fail(w, r, 403, "ORIGIN_NOT_ALLOWED", "Origem não autorizada.")
		return
	}
	statusPath := r.URL.Path == "/status" || r.URL.Path == "/debug/status"
	debugPath := r.URL.Path == "/" || r.URL.Path == "/debug/capture"
	capturePath := r.URL.Path == "/api/capture" || r.URL.Path == "/capture"
	verifyPath := r.URL.Path == "/api/signature" || r.URL.Path == "/verify"
	if !statusPath && !debugPath && !capturePath && !verifyPath {
		d.fail(w, r, 404, "NOT_FOUND", "Rota não disponível.")
		return
	}
	if r.Method == "OPTIONS" {
		if origin == "" {
			d.fail(w, r, 403, "ORIGIN_REQUIRED", "Origem necessária.")
			return
		}
		method := r.Header.Get("Access-Control-Request-Method")
		if method != "GET" || !statusPath && !debugPath {
			if method != "POST" || !capturePath && !verifyPath {
				d.fail(w, r, 405, "METHOD_NOT_ALLOWED", "Método não permitido.")
				return
			}
		}
		for _, header := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
			header = strings.ToLower(strings.TrimSpace(header))
			if header != "" && header != "content-type" && header != "x-jp-entregaepi" {
				d.fail(w, r, 403, "HEADER_NOT_ALLOWED", "Cabeçalho não permitido.")
				return
			}
		}
		d.headers(w, r)
		w.WriteHeader(204)
		return
	}
	if statusPath {
		if r.Method != "GET" {
			d.fail(w, r, 405, "METHOD_NOT_ALLOWED", "Use GET para consultar o status.")
			return
		}
		d.json(w, r, 200, d.status())
		return
	}
	if debugPath {
		if r.Method != "GET" {
			d.fail(w, r, 405, "METHOD_NOT_ALLOWED", "Método não permitido.")
			return
		}
		d.headers(w, r)
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, "<!doctype html><html lang='pt-BR'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>JP Biometria</title><style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:20px}</style><h1>JP Biometria 12.9.0</h1><p>"+runtimeMessages[d.problem]+"</p><p>Esta ponte de diagnóstico está disponível, mas a captura ainda não pode ser iniciada.</p></html>")
		return
	}
	if r.Method != "POST" {
		d.fail(w, r, 405, "METHOD_NOT_ALLOWED", "Use POST para a captura.")
		return
	}
	if origin == "" {
		d.fail(w, r, 403, "ORIGIN_REQUIRED", "Origem necessária.")
		return
	}
	if verifyPath {
		d.fail(w, r, 501, "BIOMETRIC_MATCH_NOT_SUPPORTED", "A comparação de identidade biométrica não está habilitada.")
		return
	}
	d.fail(w, r, 503, d.problem, runtimeMessages[d.problem])
}
func (d *diagnosticServer) validControl(header, payload string) ([]string, bool) {
	auth := strings.Split(header, ":")
	if len(auth) != 4 || auth[0] != "v1" || !regexp.MustCompile(`^[0-9]{10,11}$`).MatchString(auth[1]) || !regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`).MatchString(auth[2]) || !keyPattern.MatchString(auth[3]) {
		return nil, false
	}
	stamp, err := strconv.ParseInt(auth[1], 10, 64)
	now := time.Now().Unix()
	if err != nil || now-stamp > 30 || stamp-now > 30 {
		return nil, false
	}
	expected := requestMAC(d.key, "/control\n"+auth[1]+"\n"+auth[2]+"\n"+payload)
	if !hmac.Equal([]byte(expected), []byte(auth[3])) {
		return nil, false
	}
	d.mutex.Lock()
	defer d.mutex.Unlock()
	for nonce, used := range d.nonces {
		if now-used > 60 {
			delete(d.nonces, nonce)
		}
	}
	if _, exists := d.nonces[auth[2]]; exists {
		return nil, false
	}
	if len(d.nonces) >= 128 {
		return nil, false
	}
	d.nonces[auth[2]] = now
	return auth, true
}
func (d *diagnosticServer) control(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" || r.Header.Get("Origin") != "" {
		d.fail(w, r, 403, "CONTROL_DENIED", "Controle local não autorizado.")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 16385))
	if err != nil || len(body) > 16384 {
		d.fail(w, r, 413, "REQUEST_TOO_LARGE", "Solicitação excedeu o tamanho permitido.")
		return
	}
	auth, valid := d.validControl(r.Header.Get("X-JP-Control"), string(body))
	if !valid {
		d.fail(w, r, 403, "CONTROL_DENIED", "Controle local não autorizado.")
		return
	}
	var command struct {
		Command string `json:"command"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&command) != nil || decoder.Decode(new(any)) != io.EOF || command.Command != "ping" && command.Command != "shutdown" {
		d.fail(w, r, 400, "CONTROL_COMMAND_INVALID", "Comando não permitido.")
		return
	}
	proof := requestMAC(d.key, "response\n"+auth[1]+"\n"+auth[2]+"\n"+command.Command+"\n"+d.instance+"\n"+version+"\n"+strconv.Itoa(d.port)+"\n"+buildSHA)
	d.json(w, r, 200, controlResponse{OK: true, Owned: true, Version: version, BuildSHA: buildSHA, InstanceID: d.instance, Port: d.port, Proof: proof})
	if command.Command == "shutdown" {
		go func() {
			time.Sleep(150 * time.Millisecond)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			d.server.Shutdown(ctx)
		}()
	}
}
