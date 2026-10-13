package main

import (
	"path/filepath"
	"strings"
)

// Paths are fixed by the build and never include a driver, certificate or key.
func runtimeTarget(local, arch, name string) string {
	prefix := arch + "/sdk/"
	if strings.HasPrefix(name, prefix) {
		return filepath.Join(local, "JP", "Biometria", "sdk-5.2.0.6", filepath.FromSlash(strings.TrimPrefix(name, prefix)))
	}
	prefix = arch + "/jre/"
	if strings.HasPrefix(name, prefix) {
		vendor, folder := "Eclipse Adoptium", "jp-biometria-jre8u504b01"
		if arch == "x86" {
			vendor, folder = "BellSoft", "jp-biometria-jre8u504b1-x86"
		}
		return filepath.Join(local, "Programs", vendor, folder, filepath.FromSlash(strings.TrimPrefix(name, prefix)))
	}
	return ""
}
