package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExistingSDKNotHiddenByManagedPackage(t *testing.T) {
	base := t.TempDir()
	for _, key := range []string{"ProgramFiles(x86)", "ProgramW6432", "SystemDrive", "JP_BIOMETRIA_SDK"} {
		t.Setenv(key, "")
	}
	t.Setenv("ProgramFiles", filepath.Join(base, "Programs"))
	t.Setenv("LOCALAPPDATA", filepath.Join(base, "Local"))
	managed := filepath.Join(os.Getenv("LOCALAPPDATA"), "JP", "Biometria", "sdk-5.2.0.6")
	vendor := filepath.Join(os.Getenv("ProgramFiles"), "Vendor Tools", "NITGEN", "old working SDK", "SDK")
	createSearchSDK(t, managed, true)
	createSearchSDK(t, vendor, true)
	found, code := discoverInstalledSDK()
	if code != "" || len(found) != 2 || found[0].Root != vendor || found[1].Root != managed {
		t.Fatalf("existing vendor installation hidden: %+v %s", found, code)
	}
}
func TestRuntimeFallbackRejectsValidityFailure(t *testing.T) {
	candidates := []runtimeSelection{{SDK: sdkLocation{Root: "old", Arch: "amd64"}}, {SDK: sdkLocation{Root: "working", Arch: "x86"}}}
	got, attempts, valid := selectVerifiedRuntime(candidates, func(s runtimeSelection) runtimeProbeResult {
		if s.SDK.Root == "old" {
			return runtimeProbeResult{Code: "NITGEN_15", Initialized: true}
		}
		return runtimeProbeResult{Code: "READER_NOT_FOUND", Initialized: true}
	})
	if !valid || got.SDK.Root != "working" || len(attempts) != 2 {
		t.Fatal(got, attempts, valid)
	}
	for _, code := range []string{"NITGEN_15", "NITGEN_24", "SDK_LOAD_FAILED", "SDK_PROBE_TIMEOUT", "SDK_PROBE_INVALID"} {
		_, _, valid = selectVerifiedRuntime(candidates, func(runtimeSelection) runtimeProbeResult { return runtimeProbeResult{Code: code, Initialized: true} })
		if valid {
			t.Fatalf("%s was accepted", code)
		}
	}
}
func TestRuntimeStopsAfterSuccessfulInitialization(t *testing.T) {
	calls := 0
	candidates := []runtimeSelection{{SDK: sdkLocation{Root: "working"}}, {SDK: sdkLocation{Root: "unused"}}}
	got, _, valid := selectVerifiedRuntime(candidates, func(runtimeSelection) runtimeProbeResult {
		calls++
		return runtimeProbeResult{Initialized: true, Reader: true}
	})
	if !valid || got.SDK.Root != "working" || calls != 1 {
		t.Fatal(got, calls)
	}
}
func TestRuntimeCacheFingerprintInvalidatesChangedSDK(t *testing.T) {
	base := t.TempDir()
	createSearchSDK(t, base, true)
	java := filepath.Join(base, "java.exe")
	os.WriteFile(java, []byte("java fixture"), 0600)
	s := runtimeSelection{Java: javaRuntime{Path: java}, SDK: sdkLocation{Root: base, Bin: filepath.Join(base, "Bin", "x64")}}
	before := runtimeFingerprint(s)
	if before == "" {
		t.Fatal("missing fingerprint")
	}
	os.WriteFile(filepath.Join(base, "Lib", "NBioBSPJNI.jar"), []byte("changed fixture"), 0600)
	if before == runtimeFingerprint(s) {
		t.Fatal("changed SDK reused")
	}
	os.Remove(java)
	if runtimeFingerprint(s) != "" {
		t.Fatal("missing runtime reused")
	}
}
