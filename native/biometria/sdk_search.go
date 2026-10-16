package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// V11.9 also found installations below nonstandard Program Files subfolders.
// Search only installation roots, without following links or scanning user data.
func sdkSearchBases() []string {
	bases := []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("ProgramW6432")}
	if drive := os.Getenv("SystemDrive"); drive != "" {
		bases = append(bases, filepath.Join(drive+string(os.PathSeparator), "NITGEN"))
	}
	return uniquePaths(bases)
}

func searchSDKRoots(bases []string, maxEntries int, budget time.Duration) []string {
	var roots []string
	for _, base := range uniquePaths(bases) {
		deadline, visited := time.Now().Add(budget), 0
		// WalkDir does not follow symlinks (including Windows directory junctions).
		_ = filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
			if visited >= maxEntries || time.Now().After(deadline) {
				return filepath.SkipAll
			}
			visited++
			if err != nil || entry == nil {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			rel, relErr := filepath.Rel(base, path)
			if relErr != nil {
				return nil
			}
			if entry.IsDir() && strings.Count(rel, string(os.PathSeparator)) >= 10 {
				return filepath.SkipDir
			}
			if entry.IsDir() || !strings.EqualFold(entry.Name(), "NBioBSPJNI.jar") {
				return nil
			}
			lib := filepath.Dir(path)
			branded := strings.ToLower(path)
			if strings.EqualFold(filepath.Base(lib), "Lib") && (strings.Contains(branded, "nitgen") || strings.Contains(branded, "enbiobsp") || strings.Contains(branded, "enbsp")) {
				roots = append(roots, filepath.Dir(lib))
			}
			return nil
		})
	}
	return uniquePaths(roots)
}

func discoverInstalledSDK() ([]sdkLocation, string) {
	roots := sdkRoots()
	// A bundled SDK can exist but fail its own initialization. It must not hide
	// a vendor installation that worked before this package was installed.
	roots = append(roots, searchSDKRoots(sdkSearchBases(), 50000, 2*time.Second)...)
	managed := filepath.Join(os.Getenv("LOCALAPPDATA"), "JP", "Biometria", "sdk-5.2.0.6")
	var ordered []string
	for _, root := range roots {
		if !samePath(root, managed) {
			ordered = append(ordered, root)
		}
	}
	ordered = append(ordered, filepath.Join(os.Getenv("LOCALAPPDATA"), "JP", "Biometria", "sdk-5.2.0.6-jp1"), managed)
	return discoverSDK(ordered)
}

func runtimeNeedsRefresh(status map[string]any) bool {
	code, _ := status["errorCode"].(string)
	switch code {
	case "SDK_NOT_FOUND", "SDK_DLL_NOT_FOUND", "SDK_ARCH_MISMATCH", "JAVA_NOT_FOUND", "JAVA_ARCH_MISMATCH", "SDK_LOAD_FAILED":
		return true
	}
	return false
}
