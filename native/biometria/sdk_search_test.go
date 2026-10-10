package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func createSearchSDK(t *testing.T, root string, complete bool) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, "Lib"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Lib", "NBioBSPJNI.jar"), []byte("test fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if complete {
		writePE(t, filepath.Join(root, "Bin", "x64", "NBioBSP.dll"), 0x8664)
		writePE(t, filepath.Join(root, "Bin", "x64", "NBioBSPJNI.dll"), 0x8664)
	}
}

func TestInstalledSDKFindsV119NonstandardFolder(t *testing.T) {
	base := t.TempDir()
	for _, key := range []string{"ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "SystemDrive", "JP_BIOMETRIA_SDK"} {
		t.Setenv(key, "")
	}
	t.Setenv("ProgramFiles", base)
	// The installer can use a versioned/custom destination that the fixed list missed.
	want := filepath.Join(base, "Vendor Tools", "NITGEN", "eNBSP SDK 5.2", "SDK")
	createSearchSDK(t, want, true)
	createSearchSDK(t, filepath.Join(base, "NITGEN", "eNBSP SDK Professional", "SDK"), false)
	if got, _ := discoverSDK(sdkRoots()); len(got) != 0 {
		t.Fatal("fixture must reproduce the old discovery failure")
	}
	got, problem := discoverInstalledSDK()
	if problem != "" || len(got) != 1 || got[0].Root != want || got[0].Arch != "amd64" {
		t.Fatalf("nested compatible SDK was not recovered: %#v %s", got, problem)
	}
}

func TestSDKSearchStaysBoundedAndSkipsLinks(t *testing.T) {
	base := t.TempDir()
	external := filepath.Join(t.TempDir(), "NITGEN", "SDK")
	createSearchSDK(t, external, true)
	if err := os.Symlink(filepath.Dir(external), filepath.Join(base, "NITGEN-link")); err != nil {
		t.Skip("symlink unavailable")
	}
	// An unrelated archive with the same JAR filename must not become a SDK candidate.
	createSearchSDK(t, filepath.Join(base, "Unrelated", "SDK"), true)
	if got := searchSDKRoots([]string{base}, 1000, time.Second); len(got) != 0 {
		t.Fatalf("unexpected traversal: %v", got)
	}
	createSearchSDK(t, filepath.Join(base, "NITGEN", "SDK"), true)
	if got := searchSDKRoots([]string{base}, 0, time.Second); len(got) != 0 {
		t.Fatal("entry limit ignored")
	}
	if got := searchSDKRoots([]string{base}, 1000, -time.Second); len(got) != 0 {
		t.Fatal("time limit ignored")
	}
}

func TestOnlyRuntimeFailuresPermitRediscovery(t *testing.T) {
	for _, code := range []string{"SDK_NOT_FOUND", "SDK_DLL_NOT_FOUND", "SDK_ARCH_MISMATCH", "JAVA_NOT_FOUND", "JAVA_ARCH_MISMATCH", "SDK_LOAD_FAILED"} {
		if !runtimeNeedsRefresh(map[string]any{"errorCode": code}) {
			t.Fatal(code)
		}
	}
	for _, code := range []string{"", "READER_NOT_FOUND", "READER_BUSY", "SDK_CHECKING", "CAPTURE_FAILED"} {
		if runtimeNeedsRefresh(map[string]any{"errorCode": code}) {
			t.Fatalf("must not restart for %s", code)
		}
	}
}

func TestManagedSDKIsFoundWithoutEnvironmentConfiguration(t *testing.T) {
	base := t.TempDir()
	t.Setenv("LOCALAPPDATA", base)
	for _, key := range []string{"ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "SystemDrive", "JP_BIOMETRIA_SDK"} {
		t.Setenv(key, "")
	}
	want := filepath.Join(base, "JP", "Biometria", "sdk-5.2.0.6")
	createSearchSDK(t, want, true)
	got, problem := discoverInstalledSDK()
	if problem != "" || len(got) != 1 || got[0].Root != want {
		t.Fatalf("managed SDK must be found automatically: %#v %s", got, problem)
	}
}
