//go:build windows

package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

//go:embed payload.zip
var payload embed.FS

func powershell(script string) ([]byte, error) {
	words := utf16.Encode([]rune(script))
	b := make([]byte, len(words)*2)
	for i, v := range words {
		binary.LittleEndian.PutUint16(b[i*2:], v)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(b))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Output()
}
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
func message(text string, failed bool) {
	a, _ := syscall.UTF16PtrFromString(text)
	b, _ := syscall.UTF16PtrFromString("JP Biometria — instalação completa")
	flags := uintptr(0x40)
	if failed {
		flags = 0x10
	}
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(a)), uintptr(unsafe.Pointer(b)), flags)
}
func agentInstall(path string) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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
	if s["version"] != "12.9.4" {
		return nil, errors.New("AGENT_VERSION_INVALID")
	}
	return s, nil
}
func waitStatus(port int) (map[string]any, error) {
	var s map[string]any
	var e error
	for i := 0; i < 20; i++ {
		s, e = status(port)
		if e == nil && s["checking"] != true {
			return s, nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	if e != nil {
		return nil, e
	}
	return s, nil
}

type hardware struct {
	Count           int
	Working         bool
	MemoryIntegrity int
}

func inspectHardware() (hardware, error) {
	var h hardware
	b, e := powershell(`$ErrorActionPreference='Stop';$d=@(Get-CimInstance Win32_PnPEntity | Where-Object {$_.PNPDeviceID -match '^USB\\VID_0A86&PID_(0100|0200)'});$g=Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard;$v=0;if(@($g.SecurityServicesRunning) -contains 2){$v=1};[pscustomobject]@{Count=$d.Count;Working=(@($d|Where-Object {$_.ConfigManagerErrorCode -eq 0}).Count -gt 0);MemoryIntegrity=$v}|ConvertTo-Json -Compress`)
	if e != nil {
		return h, e
	}
	e = json.Unmarshal(b, &h)
	return h, e
}
func installDriver(inf string) (int, error) {
	// UAC applies only to installing the hardware driver, never to the per-user agent.
	path := filepath.Join(os.Getenv("SystemRoot"), "System32", "pnputil.exe")
	arguments := "/add-driver \"" + inf + "\" /install"
	b, e := powershell("$ErrorActionPreference='Stop';$p=Start-Process -FilePath " + quote(path) + " -ArgumentList " + quote(arguments) + " -Verb RunAs -Wait -PassThru;[pscustomobject]@{Code=$p.ExitCode}|ConvertTo-Json -Compress")
	if e != nil {
		return 0, e
	}
	var v struct{ Code int }
	e = json.Unmarshal(b, &v)
	return v.Code, e
}
func run() (string, error) {
	if strings.Contains(strings.ToUpper(os.Getenv("PROCESSOR_ARCHITECTURE")+os.Getenv("PROCESSOR_ARCHITEW6432")), "ARM") {
		return "WINDOWS_X64_REQUIRED", errors.New("architecture")
	}
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return "USER_PROFILE_UNAVAILABLE", errors.New("profile")
	}
	temp, e := os.MkdirTemp("", "JP-Biometria-")
	if e != nil {
		return "DISK_UNAVAILABLE", e
	}
	defer os.RemoveAll(temp)
	fmt.Println("1/4 Conferindo o pacote de instalação...")
	data, e := payload.ReadFile("payload.zip")
	if e != nil {
		return "PACKAGE_INVALID", e
	}
	m, e := extract(data, temp)
	if e != nil {
		return "PACKAGE_INVALID", e
	}
	agent := filepath.Join(temp, "agent.exe")
	// Install the private runtime first: a clean client need not have Java installed.
	// Existing identical files are reused; loaded or unexpected files are never replaced.
	fmt.Println("2/4 Preparando o JP Biometria...")
	for _, f := range m.Files {
		var target string
		if strings.HasPrefix(f.Name, "sdk/") {
			target = filepath.Join(local, "JP", "Biometria", "sdk-5.2.0.6", filepath.FromSlash(strings.TrimPrefix(f.Name, "sdk/")))
		}
		if strings.HasPrefix(f.Name, "jre/") {
			target = filepath.Join(local, "Programs", "Eclipse Adoptium", "jp-biometria-jre8u504b01", filepath.FromSlash(strings.TrimPrefix(f.Name, "jre/")))
		}
		if target != "" {
			if e = installFile(filepath.Join(temp, filepath.FromSlash(f.Name)), target, f.SHA256); e != nil {
				return "RUNTIME_CONFLICT", e
			}
		}
	}
	// The authenticated installer refuses to interrupt a biometric capture.
	port, e := agentInstall(agent)
	if e != nil {
		return "AGENT_INSTALL_FAILED", e
	}
	s, e := waitStatus(port)
	if e != nil {
		return "AGENT_UNAVAILABLE", e
	}
	if ready(s) {
		return "READY", nil
	}
	code, _ := s["errorCode"].(string)
	if s["sdk"] != true {
		if code == "" {
			code = "SDK_LOAD_FAILED"
		}
		return code, errors.New(code)
	}
	fmt.Println("3/4 Conferindo o Hamster DX e o driver do Windows...")
	h, e := inspectHardware()
	if e != nil {
		return "SECURITY_UNKNOWN", e
	}
	if h.Working {
		if code == "" {
			code = "READER_NOT_FOUND"
		}
		return code, errors.New(code)
	}
	if h.MemoryIntegrity == 1 {
		return "HVCI_DRIVER", errors.New("legacy driver requires compatible replacement")
	}
	exit, e := installDriver(filepath.Join(temp, "driver", "FpUSB.inf"))
	if e != nil {
		return "DRIVER_FAILED", e
	}
	if exit == 3010 || exit == 1641 {
		return "REBOOT_REQUIRED", errors.New("restart required")
	}
	if exit != 0 {
		return "DRIVER_FAILED", errors.New("driver rejected")
	}
	fmt.Println("4/4 Verificando o funcionamento...")
	time.Sleep(2 * time.Second)
	port, e = agentInstall(agent)
	if e != nil {
		return "AGENT_INSTALL_FAILED", e
	}
	s, e = waitStatus(port)
	if e != nil {
		return "AGENT_UNAVAILABLE", e
	}
	if ready(s) {
		return "READY", nil
	}
	h, e = inspectHardware()
	if e == nil && h.Count == 0 {
		return "USB_ABSENT", errors.New("connect reader")
	}
	code, _ = s["errorCode"].(string)
	if code == "" {
		code = "READER_NOT_FOUND"
	}
	return code, errors.New(code)
}
func main() {
	code, e := run()
	text := "JP Biometria 12.9.4\n\n" + solution(code)
	if e != nil {
		text += "\n\nCódigo para o suporte: " + code
	}
	if len(os.Args) == 2 && os.Args[1] == "--install-quiet" {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": e == nil, "code": code, "version": "12.9.4"})
	} else {
		message(text, e != nil)
	}
	if e != nil {
		os.Exit(1)
	}
}
