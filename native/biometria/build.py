#!/usr/bin/env python3
"""Build the JP-only Windows repairer. No NITGEN or Java vendor binaries are bundled."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
VERSION = "12.8.1"
FILENAME = f"JP-Biometria-Setup-{VERSION}.exe"
JAVA_SOURCES = ["Json.java", "BioReader.java", "NitgenReader.java", "JPBiometriaAgent.java"]


def java_bin() -> str:
    executable = os.environ.get("JAVA_BIN") or shutil.which("java")
    if not executable:
        raise RuntimeError("Java 17 with the jdk.compiler module is required for compilation.")
    return executable


def go_bin() -> str:
    executable = os.environ.get("GO_BIN") or shutil.which("go")
    if not executable:
        raise RuntimeError("Go is required. Set GO_BIN or add go to PATH.")
    return executable


def compile_java(destination: Path, *, tests: bool = False) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    sources = JAVA_SOURCES + (["JPBiometriaAgentTest.java"] if tests else [])
    subprocess.run(
        [java_bin(), "-m", "jdk.compiler/com.sun.tools.javac.Main", "--release", "8", "-encoding", "UTF-8", "-d", str(destination)]
        + [str(ROOT / "java" / source) for source in sources],
        check=True,
        cwd=ROOT,
    )


def build_payload(classes: Path) -> Path:
    """Reproducible JAR containing only production JP classes; excludes every test class."""
    payload = ROOT / "payload" / "JPBiometriaAgent.jar"
    payload.parent.mkdir(parents=True, exist_ok=True)
    entries = {"META-INF/MANIFEST.MF": b"Manifest-Version: 1.0\r\nMain-Class: JPBiometriaAgent\r\n\r\n"}
    permitted = ("Json", "BioReader", "BioFailure", "NitgenReader", "JPBiometriaAgent")
    for path in sorted(classes.rglob("*.class")):
        name = path.relative_to(classes).as_posix()
        if "$" in name:
            class_name = name.split("$", 1)[0]
        else:
            class_name = name.removesuffix(".class")
        if class_name in permitted:
            entries[name] = path.read_bytes()
    if "JPBiometriaAgent.class" not in entries:
        raise RuntimeError("The production agent did not compile.")
    with tempfile.NamedTemporaryFile(dir=payload.parent, delete=False, suffix=".jar") as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(entries.items()):
                entry = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o644 << 16
                archive.writestr(entry, data)
        os.replace(temporary, payload)
    finally:
        temporary.unlink(missing_ok=True)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build-sha", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-fA-F]{40}", args.build_sha):
        parser.error("--build-sha must be the full 40-character Git commit SHA")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    allowed = {FILENAME, "biometria-release.json"}
    extras = [p.name for p in output.iterdir() if p.name not in allowed]
    if extras:
        parser.error("--output must be a dedicated directory containing only the release EXE and manifest")
    with tempfile.TemporaryDirectory(prefix="jp-biometria-build-") as temp:
        classes = Path(temp) / "classes"
        compile_java(classes)
        build_payload(classes)
        executable = Path(temp) / FILENAME
        env = dict(os.environ, GOOS="windows", GOARCH="amd64", CGO_ENABLED="0", GOTOOLCHAIN="local")
        subprocess.run(
            [go_bin(), "build", "-trimpath", "-buildvcs=false", "-ldflags", f"-H windowsgui -s -w -buildid= -X main.buildSHA={args.build_sha}", "-o", str(executable), "."],
            check=True,
            cwd=ROOT,
            env=env,
        )
        data = executable.read_bytes()
        if data[:2] != b"MZ":
            raise RuntimeError("The output is not a Windows executable")
        (output / FILENAME).write_bytes(data)
        manifest = {
            "version": VERSION,
            "buildSha": args.build_sha,
            "filename": FILENAME,
            "sha256": hashlib.sha256(data).hexdigest(),
            "sizeBytes": len(data),
            "platform": "windows-amd64",
            "javaBytecodeRelease": 8,
            "vendorBinariesIncluded": False,
        }
        (output / "biometria-release.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Built {FILENAME}; SHA-256 {manifest['sha256']}; {manifest['sizeBytes']} bytes. Windows executable was not run.")


if __name__ == "__main__":
    main()
