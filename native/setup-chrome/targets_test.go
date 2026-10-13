package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestArchitectureIsolation(t *testing.T) {
	for _, arch := range []string{"x86", "amd64"} {
		other := "x86"
		if arch == other {
			other = "amd64"
		}
		if runtimeTarget("profile", arch, other+"/jre/bin/java.exe") != "" {
			t.Fatal("foreign runtime installed")
		}
		if runtimeTarget("profile", arch, "driver/FpUSB.inf") != "" {
			t.Fatal("driver installed")
		}
		if runtimeTarget("profile", arch, "agent.exe") != "" {
			t.Fatal("agent bypasses authenticated installer")
		}
		target := runtimeTarget("profile", arch, arch+"/sdk/Lib/NBioBSPJNI.jar")
		if !strings.HasSuffix(target, filepath.Join("sdk-5.2.0.6", "Lib", "NBioBSPJNI.jar")) {
			t.Fatal(target)
		}
	}
}
