#!/usr/bin/env python3
"""Run platform-neutral bridge tests before build.py, including in a clean checkout."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

from build import ROOT, build_payload, compile_java, go_bin, java_bin


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="jp-biometria-test-") as temp:
        classes = Path(temp) / "classes"
        compile_java(classes, tests=True)
        subprocess.run([java_bin(), "-Djava.awt.headless=true", "-cp", str(classes), "JPBiometriaAgentTest"], check=True, cwd=ROOT, timeout=45)
        payload = build_payload(classes)
        with zipfile.ZipFile(payload) as archive:
            assert not any("Test" in name or "nitgen/" in name.lower() for name in archive.namelist()), "No fake reader or vendor class may ship"
            for name in archive.namelist():
                if name.endswith(".class"):
                    data = archive.read(name)
                    assert data[:4] == b"\xca\xfe\xba\xbe" and int.from_bytes(data[6:8], "big") == 52, f"Java 8 bytecode required: {name}"
        env = dict(os.environ, CGO_ENABLED="0", GOTOOLCHAIN="local")
        env.pop("GOOS", None)
        env.pop("GOARCH", None)
        subprocess.run([go_bin(), "test", "-count=1", "-timeout", "45s", "./..."], check=True, cwd=ROOT, env=env, timeout=90)
    print("Native tests passed. No Windows EXE, NITGEN SDK, physical reader, or actual fingerprint was executed/used.")


if __name__ == "__main__":
    main()
