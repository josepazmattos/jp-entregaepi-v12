//go:build windows

package main

import (
	"archive/zip"
	"context"
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

const releaseVersion = "12.10.0-unico1"
const agentVersion = "12.10.0-bio2"

func powershell(script string) ([]byte, error) {
	words := utf16.Encode([]rune(script))
	b := make([]byte, len(words)*2)
	for i, v := range words {
		binary.LittleEndian.PutUint16(b[i*2:], v)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(os.Getenv("SystemRoot"), "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(b))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Output()
}
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

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
	b, _ := syscall.UTF16PtrFromString("JP Biometria — instalador único")
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

type hardware struct {
	Count           int
	Working         bool
	MemoryIntegrity int
}

func inspectHardware() (hardware, error) {
	var h hardware
	b, e := powershell(`$ErrorActionPreference='Stop';$d=@(Get-CimInstance Win32_PnPEntity | Where-Object {$_.PNPDeviceID -match '^USB\\VID_0A86&PID_(0100|0200)'});$v=-1;try{$g=Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard;$v=0;if(@($g.SecurityServicesRunning) -contains 2){$v=1}}catch{};[pscustomobject]@{Count=$d.Count;Working=(@($d|Where-Object {$_.ConfigManagerErrorCode -eq 0}).Count -gt 0);MemoryIntegrity=$v}|ConvertTo-Json -Compress`)
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

func run() (string, string, error) {
	arch, e := nativeArchitecture()
	if e != nil {
		return "ARCHITECTURE_UNSUPPORTED", "", e
	}
	if arch != "amd64" {
		return "WINDOWS_X64_REQUIRED", arch, errors.New("architecture")
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
	executable, e := os.Executable()
	if e != nil {
		return "PACKAGE_INVALID", arch, e
	}
	archive, e := zip.OpenReader(executable)
	if e != nil {
		return "PACKAGE_INVALID", arch, e
	}
	defer archive.Close()
	fmt.Println("1/4 Conferindo o instalador único...")
	m, e := extract(&archive.Reader, temp)
	if e != nil {
		return "PACKAGE_INVALID", arch, e
	}
	fmt.Println("2/4 Instalando os componentes de biometria...")
	for _, f := range m.Files {
		target := runtimeTarget(local, arch, f.Name)
		if target != "" {
			if e = installFile(filepath.Join(temp, filepath.FromSlash(f.Name)), target, f.SHA256); e != nil {
				return "RUNTIME_CONFLICT", arch, e
			}
		}
	}
	fmt.Println("3/4 Verificando o driver do leitor...")
	rebootRequired := false
	h, hardwareErr := inspectHardware()
	if hardwareErr == nil && h.Count > 0 && !h.Working {
		if h.MemoryIntegrity < 0 {
			return "SECURITY_UNKNOWN", arch, errors.New("driver compatibility unknown")
		}
		if h.MemoryIntegrity != 0 {
			return "HVCI_DRIVER", arch, errors.New("driver compatibility")
		}
		code, driverErr := installDriver(filepath.Join(temp, "driver", "FpUSB.inf"))
		if driverErr != nil {
			return "DRIVER_FAILED", arch, driverErr
		}
		if code == 3010 || code == 1641 {
			rebootRequired = true
		}
		if code != 0 && !rebootRequired {
			return "DRIVER_FAILED", arch, errors.New("driver rejected")
		}
		after, err := inspectHardware()
		if !rebootRequired && (err != nil || !after.Working) {
			return "DRIVER_FAILED", arch, errors.New("driver verification")
		}
	}
	fmt.Println("4/4 Iniciando e testando o JP Biometria...")
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
	if rebootRequired {
		return "REBOOT_REQUIRED", arch, errors.New("restart required")
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
	text := "JP Biometria — instalador único\n\n"
	switch code {
	case "READY":
		text += "Leitor localizado. Volte ao Chrome e clique em Testar captura."
	case "ARCHITECTURE_UNSUPPORTED", "WINDOWS_X64_REQUIRED":
		text += "Este instalador atende Windows 10 e 11 de 64 bits em computadores Intel/AMD."
	case "NITGEN_15", "NITGEN_24":
		text += "Os componentes foram instalados, mas o SDK NITGEN recusou a inicialização. Envie este código ao suporte JP. Repetir a instalação não corrige essa falha do SDK."
	case "READER_NOT_FOUND":
		text += "Componentes instalados e SDK inicializado. Conecte o leitor, feche outros programas de biometria e clique em Testar leitor no aplicativo."
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
