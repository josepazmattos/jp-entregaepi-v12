package main

import (
	"path/filepath"
	"strings"
)

// The registered runtime is versioned separately from earlier unregistered SDK files.
func runtimeTarget(local, arch, name string) string {
	if strings.HasPrefix(name, "sdk/") {
		return filepath.Join(local, "JP", "Biometria", "sdk-5.2.0.6-jp1", filepath.FromSlash(strings.TrimPrefix(name, "sdk/")))
	}
	prefix := arch + "/jre/"
	if strings.HasPrefix(name, prefix) {
		vendor, folder := "Eclipse Adoptium", "jp-biometria-jre8u504b01"
		if arch == "x86" {
			vendor, folder = "BellSoft", "jp-biometria-jre8u504b1-x86"
		}
		return filepath.Join(local, "Programs", vendor, folder, filepath.FromSlash(strings.TrimPrefix(name, prefix)))
	}
	return ""
}
