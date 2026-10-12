//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

var browsers = []string{"Google\\Chrome", "Microsoft\\Edge"}

func message(text string, failed bool) {
	t, _ := syscall.UTF16PtrFromString(text)
	title, _ := syscall.UTF16PtrFromString("JP Biometria · Conector piloto")
	flags := uintptr(0x40)
	if failed {
		flags = 0x10
	}
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(title)), flags)
}

func registrationKey(browser string) string {
	return `HKCU\Software\` + browser + `\NativeMessagingHosts\` + hostName
}
func reg(args ...string) error {
	root := os.Getenv("SystemRoot")
	if !filepath.IsAbs(root) {
		return errors.New("Windows não localizado")
	}
	cmd := exec.Command(filepath.Join(root, "System32", "reg.exe"), args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func installConnector() error {
	base := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(base) {
		return errors.New("A pasta do usuário do Windows não está disponível.")
	}
	dir := filepath.Join(base, "JP", "BiometriaExtensao")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return errors.New("Não foi possível criar a pasta do conector.")
	}
	source, err := os.Executable()
	if err != nil {
		return err
	}
	target := filepath.Join(dir, "JPBiometriaConector.exe")
	if !strings.EqualFold(filepath.Clean(source), filepath.Clean(target)) {
		data, err := os.ReadFile(source)
		if err != nil {
			return errors.New("Não foi possível ler o instalador.")
		}
		tmp := target + ".new"
		if err = os.WriteFile(tmp, data, 0700); err != nil {
			return errors.New("Não foi possível gravar o conector.")
		}
		defer os.Remove(tmp)
		from, _ := syscall.UTF16PtrFromString(tmp)
		to, _ := syscall.UTF16PtrFromString(target)
		ok, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW").Call(uintptr(unsafe.Pointer(from)), uintptr(unsafe.Pointer(to)), 0x1|0x8)
		if ok == 0 {
			return errors.New("Feche o painel da extensão e execute o instalador novamente.")
		}
	}
	manifest := map[string]any{"name": hostName, "description": "JP Biometria - conector de diagnóstico piloto", "path": target, "type": "stdio", "allowed_origins": []string{"chrome-extension://" + extensionID + "/"}}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "native-host.json")
	if err = os.WriteFile(path, data, 0600); err != nil {
		return errors.New("Não foi possível salvar a configuração do conector.")
	}
	for _, browser := range browsers {
		for _, view := range []string{"/reg:32", "/reg:64"} {
			if reg("add", registrationKey(browser), "/ve", "/t", "REG_SZ", "/d", path, "/f", view) != nil {
				return errors.New("Não foi possível registrar o conector. Verifique com o suporte se uma política da empresa bloqueia extensões.")
			}
		}
	}
	return nil
}

func uninstallConnector() error {
	// Only this connector's own registration; existing JP agent, driver and certificates are untouched.
	for _, browser := range browsers {
		for _, view := range []string{"/reg:32", "/reg:64"} {
			if reg("query", registrationKey(browser), "/ve", view) == nil && reg("delete", registrationKey(browser), "/f", view) != nil {
				return errors.New("Não foi possível remover o registro do conector.")
			}
		}
	}
	return nil
}

func installer(uninstall bool) {
	if uninstall {
		if err := uninstallConnector(); err != nil {
			message(err.Error(), true)
			return
		}
		message("Conector desativado para Chrome e Edge. Remova a extensão no navegador. A pasta JP\\BiometriaExtensao pode ser excluída após fechar esta janela. O agente JP existente foi preservado.", false)
		return
	}
	if err := installConnector(); err != nil {
		message(fmt.Sprintf("Instalação não concluída.\n\n%s", err), true)
		return
	}
	message("Conector piloto instalado para este usuário do Windows.\n\nAbra a extensão JP Biometria e clique em Verificar leitor. O agente JP já instalado deve estar aberto.\n\nEsta mensagem confirma a instalação do conector; a leitura será testada na extensão.", false)
}
