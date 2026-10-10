package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type entry struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type manifest struct {
	Version string  `json:"version"`
	Files   []entry `json:"files"`
}

// All payload bytes are verified before any executable or driver is launched.
func extract(data []byte, destination string) (manifest, error) {
	var m manifest
	z, e := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if e != nil {
		return m, e
	}
	files := map[string]*zip.File{}
	for _, f := range z.File {
		n := f.Name
		if n == "" || strings.Contains(n, "\\") || strings.Contains(n, ":") || strings.HasPrefix(n, "/") || filepath.ToSlash(filepath.Clean(n)) != n || n == ".." || strings.HasPrefix(n, "../") || f.Mode()&os.ModeSymlink != 0 {
			return m, errors.New("PACKAGE_PATH_INVALID")
		}
		if _, ok := files[n]; ok {
			return m, errors.New("PACKAGE_DUPLICATE")
		}
		files[n] = f
	}
	mf, ok := files["manifest.json"]
	if !ok || mf.UncompressedSize64 > 1024*1024 {
		return m, errors.New("PACKAGE_MANIFEST_INVALID")
	}
	r, e := mf.Open()
	if e != nil {
		return m, e
	}
	b, e := io.ReadAll(io.LimitReader(r, 1024*1024))
	r.Close()
	if e != nil {
		return m, e
	}
	if json.Unmarshal(b, &m) != nil || m.Version != "12.9.4" || len(m.Files) != len(files)-1 {
		return m, errors.New("PACKAGE_MANIFEST_INVALID")
	}
	seen := map[string]bool{}
	for _, item := range m.Files {
		f, ok := files[item.Name]
		if !ok || seen[item.Name] || item.Name == "manifest.json" || item.Size < 0 || item.Size > 150*1024*1024 || int64(f.UncompressedSize64) != item.Size {
			return m, errors.New("PACKAGE_SIZE_INVALID")
		}
		seen[item.Name] = true
		r, e := f.Open()
		if e != nil {
			return m, e
		}
		b, e := io.ReadAll(io.LimitReader(r, item.Size+1))
		r.Close()
		if e != nil {
			return m, e
		}
		h := sha256.Sum256(b)
		if int64(len(b)) != item.Size || hex.EncodeToString(h[:]) != item.SHA256 {
			return m, errors.New("PACKAGE_HASH_INVALID")
		}
		target := filepath.Join(destination, filepath.FromSlash(item.Name))
		if e = os.MkdirAll(filepath.Dir(target), 0700); e != nil {
			return m, e
		}
		if e = os.WriteFile(target, b, 0600); e != nil {
			return m, e
		}
	}
	return m, nil
}

func installFile(source, target, hash string) error {
	b, e := os.ReadFile(source)
	if e != nil {
		return e
	}
	h := sha256.Sum256(b)
	if hex.EncodeToString(h[:]) != hash {
		return errors.New("PACKAGE_HASH_INVALID")
	}
	if old, e := os.ReadFile(target); e == nil {
		oldHash := sha256.Sum256(old)
		if oldHash == h {
			return nil
		}
		// Never replace a loaded runtime or an unexpected file in place.
		return fmt.Errorf("RUNTIME_CONFLICT: %s", filepath.Base(target))
	}
	if e = os.MkdirAll(filepath.Dir(target), 0700); e != nil {
		return e
	}
	f, e := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(b)
	closeErr := f.Close()
	if e != nil {
		os.Remove(target)
		return e
	}
	return closeErr
}

func ready(s map[string]any) bool {
	return s["ok"] == true && s["sdk"] == true && s["reader"] == true && s["checking"] != true && s["busy"] != true
}
func solution(code string) string {
	switch code {
	case "READY":
		return "Leitor pronto. Abra Trabalhadores > Digitais ou a ficha de EPI para assinar."
	case "HVCI_DRIVER":
		return "O driver fornecido pode ser incompatível com a proteção de memória ativa neste Windows. Solicite à FingerTech o driver HFDU06 compatível. Nenhuma proteção foi desativada."
	case "USB_ABSENT":
		return "Conecte o Hamster DX diretamente a uma porta USB e execute este instalador novamente."
	case "READER_NOT_FOUND":
		return "Feche SOC e outros programas de biometria, reconecte o Hamster DX e execute novamente. Se continuar, envie este código ao suporte JP."
	case "SDK_NOT_FOUND", "SDK_DLL_NOT_FOUND", "SDK_LOAD_FAILED", "SDK_API_INCOMPATIBLE":
		return "O componente NITGEN não carregou. Envie este código ao suporte JP; não é necessário digitar serial ou procurar arquivos."
	case "JAVA_NOT_FOUND", "JAVA_ARCH_MISMATCH":
		return "O Java incluído no pacote não iniciou. Verifique se o antivírus bloqueou o JP Biometria e envie este código ao suporte JP."
	case "DRIVER_FAILED":
		return "O Windows não aceitou o driver fornecido. Envie este código ao suporte JP para obter o driver compatível; não desative proteções do Windows."
	case "REBOOT_REQUIRED":
		return "Reinicie o computador e execute este instalador novamente para concluir a verificação."
	case "READER_BUSY":
		return "Conclua a captura em andamento e feche os outros programas que utilizam o leitor. Depois execute novamente."
	case "SECURITY_UNKNOWN":
		return "Não foi possível conferir a compatibilidade do driver com a segurança do Windows. Envie este código ao suporte JP."
	default:
		return "A instalação não foi concluída. Envie este código ao suporte JP. As digitais e fichas existentes foram preservadas."
	}
}
