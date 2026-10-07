//go:build windows

package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var kernel32 = syscall.NewLazyDLL("kernel32.dll")
var user32 = syscall.NewLazyDLL("user32.dll")
var procMoveFileEx = kernel32.NewProc("MoveFileExW")
var procCreateMutex = kernel32.NewProc("CreateMutexW")
var procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
var procReleaseMutex = kernel32.NewProc("ReleaseMutex")
var procMessageBox = user32.NewProc("MessageBoxW")

func requireWindows() error         { return nil }
func configureHidden(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
func notifyUser(message string, failed bool) {
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("JP Biometria 12.9.0")
	flags := uintptr(0x40)
	if failed {
		flags = 0x10
	}
	procMessageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), flags)
}
func replaceFile(source, destination string) error {
	src, err := syscall.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	dst, err := syscall.UTF16PtrFromString(destination)
	if err != nil {
		return err
	}
	result, _, callErr := procMoveFileEx.Call(uintptr(unsafe.Pointer(src)), uintptr(unsafe.Pointer(dst)), 0x1|0x8)
	if result == 0 {
		return callErr
	}
	return nil
}
func launcherMutex(dir string) (func(), error) {
	// Windows mutex ownership belongs to the OS thread, not to a Go goroutine.
	runtime.LockOSThread()
	digest := sha256.Sum256([]byte(strings.ToLower(dir)))
	name, _ := syscall.UTF16PtrFromString(fmt.Sprintf(`Local\JPBiometriaLauncher-%x`, digest[:10]))
	handle, _, err := procCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		runtime.UnlockOSThread()
		return nil, err
	}
	result, _, waitErr := procWaitForSingleObject.Call(handle, 10000)
	if result != 0 && result != 0x80 {
		syscall.CloseHandle(syscall.Handle(handle))
		runtime.UnlockOSThread()
		return nil, fmt.Errorf("mutex unavailable: %v", waitErr)
	}
	return func() {
		procReleaseMutex.Call(handle)
		syscall.CloseHandle(syscall.Handle(handle))
		runtime.UnlockOSThread()
	}, nil
}
func systemExecutable(name string) string {
	return filepath.Join(os.Getenv("SystemRoot"), "System32", name)
}
func protectInstallDirectory(dir string) error {
	account, err := user.Current()
	if err != nil {
		return err
	}
	if !regexp.MustCompile(`^S-1-[0-9-]+$`).MatchString(account.Uid) {
		return fmt.Errorf("identidade do usuário não localizada")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, systemExecutable("icacls.exe"), dir, "/inheritance:r", "/grant:r", "*"+account.Uid+":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F")
	configureHidden(cmd)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("a proteção da pasta do usuário falhou: %w", err)
	}
	return nil
}
func registerLauncher(executable string) error {
	for index, args := range registryOperations(executable) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		cmd := exec.CommandContext(ctx, systemExecutable("reg.exe"), args...)
		configureHidden(cmd)
		err := cmd.Run()
		cancel()
		if err != nil {
			return fmt.Errorf("registro do usuário, operação %d: %w", index+1, err)
		}
	}
	return nil
}
func registryJavaCandidates() []string {
	var paths []string
	for _, hive := range []string{`HKLM\SOFTWARE\JavaSoft`, `HKCU\SOFTWARE\JavaSoft`} {
		for _, view := range []string{"/reg:64", "/reg:32"} {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			cmd := exec.CommandContext(ctx, systemExecutable("reg.exe"), "QUERY", hive, "/s", "/v", "JavaHome", view)
			configureHidden(cmd)
			out := &limitedBuffer{Limit: 64 * 1024}
			cmd.Stdout = out
			err := cmd.Run()
			cancel()
			if err != nil {
				continue
			}
			for _, line := range strings.Split(out.String(), "\n") {
				if at := strings.Index(line, "REG_SZ"); at >= 0 && strings.Contains(line[:at], "JavaHome") {
					home := strings.TrimSpace(line[at+len("REG_SZ"):])
					if home != "" {
						paths = append(paths, filepath.Join(home, "bin", "java.exe"))
					}
				}
			}
		}
	}
	return uniquePaths(paths)
}
