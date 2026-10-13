//go:build windows

package main

import (
	"context"
	"embed"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload.zip
var payload embed.FS

const releaseVersion = "12.10.0-chrome1"
const agentVersion = "12.10.0-bio2"

func nativeArchitecture() (string, error) {
	var info [64]byte
	syscall.NewLazyDLL("kernel32.dll").NewProc("GetNativeSystemInfo").Call(uintptr(unsafe.Pointer(&info[0])))
	switch binary.LittleEndian.Uint16(info[:2]) {
	case 0:
		return "x86", nil
	case 9:
		return "amd64", nil
	default:
		return "", errors.New("ARCHITECTURE_UNSUPPORTED")
	}
}
func message(text string, failed bool) {
	a, _ := syscall.UTF16PtrFromString(text)
	b, _ := syscall.UTF16PtrFromString("JP Biometria — Windows 10 e 11")
	flags := uintptr(0x40)
	if failed {
		flags = 0x30
	}
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(a)), uintptr(unsafe.Pointer(b)), flags)
}
func installAgent(path string) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--install-quiet")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	b, e := cmd.Output()
	if e != nil {
		return 0, errors.New("AGENT_INSTALL_FAILED")
	}
	var result struct {
		OK   bool `json:"ok"`
		Port int  `json:"port"`
	}
	if json.Unmarshal(b, &result) != nil || !result.OK || result.Port < 8789 || result.Port > 8799 {
		return 0, errors.New("AGENT_INSTALL_FAILED")
	}
	return result.Port, nil
}
func status(port int) (map[string]any, error) {
	client := http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}}
	r, e := client.Get(fmt.Sprintf("http://127.0.0.1:%d/status", port))
	if e != nil {
		return nil, e
	}
	defer r.Body.Close()
	var s map[string]any
	e = json.NewDecoder(io.LimitReader(r.Body, 32768)).Decode(&s)
	if e != nil {
		return nil, e
	}
	if s["version"] != agentVersion {
		return nil, errors.New("AGENT_VERSION_INVALID")
	}
	return s, nil
}
func run() (string, string, error) {
	arch, e := nativeArchitecture()
	if e != nil {
		return "ARCHITECTURE_UNSUPPORTED", "", e
	}
	// This option exercises the real 32-bit runtime under WOW64 in CI/support.
	for _, arg := range os.Args[1:] {
		if arg == "--runtime-x86" {
			arch = "x86"
		}
	}
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return "USER_PROFILE_UNAVAILABLE", arch, errors.New("profile")
	}
	temp, e := os.MkdirTemp("", "JP-Biometria-")
	if e != nil {
		return "DISK_UNAVAILABLE", arch, e
	}
	defer os.RemoveAll(temp)
	data, e := payload.ReadFile("payload.zip")
	if e != nil {
		return "PACKAGE_INVALID", arch, e
	}
	m, e := extract(data, temp)
	if e != nil {
		return "PACKAGE_INVALID", arch, e
	}
	fmt.Println("Preparando os componentes de biometria. Aguarde...")
	for _, f := range m.Files {
		target := runtimeTarget(local, arch, f.Name)
		if target != "" {
			if e = installFile(filepath.Join(temp, filepath.FromSlash(f.Name)), target, f.SHA256); e != nil {
				return "RUNTIME_CONFLICT", arch, e
			}
		}
	}
	port, e := installAgent(filepath.Join(temp, "agent.exe"))
	if e != nil {
		return "AGENT_INSTALL_FAILED", arch, e
	}
	var s map[string]any
	for i := 0; i < 60; i++ {
		s, e = status(port)
		if e == nil && s["checking"] != true && s["errorCode"] != "INITIALIZING" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if e != nil {
		return "AGENT_UNAVAILABLE", arch, e
	}
	if ready(s) {
		return "READY", arch, nil
	}
	code, _ := s["errorCode"].(string)
	if code == "" {
		code = "READER_NOT_FOUND"
	}
	return code, arch, errors.New(code)
}
func main() {
	code, arch, e := run()
	text := "JP Biometria — Windows 10 e 11\n\n"
	switch code {
	case "READY":
		text += "Leitor localizado. Volte ao Chrome e clique em Testar captura."
	case "ARCHITECTURE_UNSUPPORTED":
		text += "Este pacote atende computadores Intel/AMD de 32 e 64 bits. Windows ARM exige componentes do fabricante compatíveis."
	case "NITGEN_15", "NITGEN_24":
		text += "Os componentes foram instalados, mas o SDK NITGEN recusou a inicialização. Envie este código ao suporte JP. Repetir a instalação não corrige essa falha do SDK."
	case "READER_NOT_FOUND":
		text += "Componentes instalados. Conecte o leitor com o driver instalado, feche o diagnóstico NITGEN/SOC e clique em Verificar leitor no aplicativo."
	default:
		text += solution(code)
	}
	if e != nil {
		text += "\n\nCódigo: " + code
	}
	quiet := false
	for _, arg := range os.Args[1:] {
		if arg == "--install-quiet" {
			quiet = true
		}
	}
	if quiet {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": e == nil, "code": code, "version": releaseVersion, "architecture": arch})
	} else {
		message(text, e != nil)
	}
	if e != nil {
		os.Exit(1)
	}
}
