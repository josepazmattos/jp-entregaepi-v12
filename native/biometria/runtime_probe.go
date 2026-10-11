package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"
)

var diagnosticCodePattern = regexp.MustCompile(`^[A-Z0-9_]{1,60}$`)

type runtimeProbeResult struct {
	Initialized bool   `json:"initialized"`
	Reader      bool   `json:"reader"`
	Code        string `json:"code"`
}
type runtimeAttempt struct {
	SDK         string `json:"sdk"`
	Arch        string `json:"arch"`
	Code        string `json:"code"`
	Initialized bool   `json:"initialized"`
}
type runtimeRemembered struct {
	Selection   runtimeSelection `json:"selection"`
	Fingerprint string           `json:"fingerprint"`
}

func runtimeFingerprint(s runtimeSelection) string {
	h := sha256.New()
	for _, path := range []string{s.Java.Path, filepath.Join(s.SDK.Root, "Lib", "NBioBSPJNI.jar"), filepath.Join(s.SDK.Bin, "NBioBSP.dll"), filepath.Join(s.SDK.Bin, "NBioBSPJNI.dll")} {
		f, err := os.Open(path)
		if err != nil {
			return ""
		}
		_, err = io.Copy(h, io.LimitReader(f, 64*1024*1024))
		f.Close()
		if err != nil {
			return ""
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}
func probeRuntime(ctx context.Context, dir string, s runtimeSelection) runtimeProbeResult {
	result := runtimeProbeResult{Code: "SDK_PROBE_FAILED"}
	f, err := os.CreateTemp(dir, "runtime-probe-*.json")
	if err != nil {
		return result
	}
	name := f.Name()
	f.Close()
	defer os.Remove(name)
	args := javaArguments(dir, firstPort, s)
	args[len(args)-1] = "RuntimeProbe"
	args = append(args, name)
	cmd := exec.CommandContext(ctx, s.Java.Path, args...)
	cmd.Dir = dir
	cmd.Env = environmentWith(os.Environ(), "PATH", s.SDK.Bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	configureHidden(cmd)
	// No logging of native output. This separate process loads only one SDK pair.
	if err = cmd.Run(); err != nil {
		if ctx.Err() != nil {
			result.Code = "SDK_PROBE_TIMEOUT"
		}
		return result
	}
	info, err := os.Stat(name)
	if err != nil || info.Size() > 4096 {
		return result
	}
	data, err := os.ReadFile(name)
	if err != nil || json.Unmarshal(data, &result) != nil {
		return runtimeProbeResult{Code: "SDK_PROBE_INVALID"}
	}
	if result.Code != "" && !diagnosticCodePattern.MatchString(result.Code) {
		return runtimeProbeResult{Code: "SDK_PROBE_INVALID"}
	}
	// A permissive 'sdk=true' from a failed Initialize is not a successful SDK.
	result.Initialized = result.Initialized && (result.Code == "" || result.Code == "READER_NOT_FOUND")
	return result
}

func selectVerifiedRuntime(candidates []runtimeSelection, probe func(runtimeSelection) runtimeProbeResult) (runtimeSelection, []runtimeAttempt, bool) {
	var attempts []runtimeAttempt
	for _, s := range candidates {
		r := probe(s)
		r.Initialized = r.Initialized && (r.Code == "" || r.Code == "READER_NOT_FOUND")
		attempts = append(attempts, runtimeAttempt{s.SDK.Root, s.SDK.Arch, r.Code, r.Initialized})
		if r.Initialized && (r.Code == "" || r.Code == "READER_NOT_FOUND") {
			return s, attempts, true
		}
	}
	if len(candidates) > 0 {
		return candidates[0], attempts, false
	}
	return runtimeSelection{}, attempts, false
}

func discoverVerifiedRuntime(dir string) runtimeSelection {
	locations, problem := discoverInstalledSDK()
	var runtimes []javaRuntime
	for _, candidate := range javaCandidates() {
		if java, err := inspectJava(candidate); err == nil {
			runtimes = append(runtimes, java)
		}
	}
	fallback := selectRuntime(locations, problem, runtimes)
	if fallback.Problem != "" {
		return fallback
	}
	var candidates []runtimeSelection
	for _, sdk := range locations {
		for _, java := range runtimes {
			if java.Arch == sdk.Arch {
				candidates = append(candidates, runtimeSelection{Java: java, SDK: sdk})
				break
			}
		}
	}
	cachePath := filepath.Join(dir, "runtime-verified.json")
	var remembered runtimeRemembered
	if data, err := os.ReadFile(cachePath); err == nil && len(data) < 8192 && json.Unmarshal(data, &remembered) == nil {
		for i, s := range candidates {
			if s == remembered.Selection && remembered.Fingerprint != "" && runtimeFingerprint(s) == remembered.Fingerprint {
				candidates = append([]runtimeSelection{s}, append(candidates[:i], candidates[i+1:]...)...)
				break
			}
		}
	}
	deadline, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	selected, attempts, valid := selectVerifiedRuntime(candidates, func(s runtimeSelection) runtimeProbeResult {
		if deadline.Err() != nil {
			return runtimeProbeResult{Code: "SDK_PROBE_TIMEOUT"}
		}
		ctx, stop := context.WithTimeout(deadline, 5*time.Second)
		defer stop()
		return probeRuntime(ctx, dir, s)
	})
	// Protected local report: component locations and codes only, no serials or fingerprints.
	report, _ := json.MarshalIndent(map[string]any{"version": version, "sdkInitialized": valid, "attempts": attempts}, "", "  ")
	_ = writeAtomic(filepath.Join(dir, "runtime-diagnostic.json"), report, 0600)
	if valid {
		saved, _ := json.Marshal(runtimeRemembered{selected, runtimeFingerprint(selected)})
		_ = writeAtomic(cachePath, saved, 0600)
	} else {
		_ = os.Remove(cachePath)
	}
	return selected
}
