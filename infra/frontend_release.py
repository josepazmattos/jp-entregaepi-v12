"""Build immutable public assets; entry HTML and runtime config stay uncached."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
FRESH_CACHE = "no-store, no-cache, must-revalidate"
STATIC_SUFFIXES = {".js", ".mjs", ".css", ".svg", ".png", ".ico", ".xlsx", ".html", ".txt"}


def release_assets(source: Path, stage: Path, commit: str, prefix: str = "EntregaEPI") -> list[dict]:
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or not re.fullmatch(r"[A-Za-z0-9_-]+", prefix):
        raise ValueError("Invalid release identifier or application prefix")
    files = []
    for source_file in sorted((source / "assets").rglob("*")):
        if source_file.is_symlink():
            raise ValueError("Symbolic links are not allowed in public releases")
        if not source_file.is_file():
            continue
        if source_file.suffix.lower() not in STATIC_SUFFIXES and source_file.name != "LICENSE":
            continue  # Installers and their manifests keep their existing download paths.
        relative = source_file.relative_to(source)
        if any(c in relative.as_posix() for c in ("\n", "\r", "\\")):
            raise ValueError("Invalid public asset name")
        target = stage / "releases" / commit / relative
        data = source_file.read_bytes()
        if target.exists() and target.read_bytes() != data:
            raise ValueError("An immutable release cannot be overwritten")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        files.append({"key": f"{prefix}/releases/{commit}/{relative.as_posix()}",
                      "file": target.relative_to(stage).as_posix(), "source": relative.as_posix(),
                      "cacheControl": IMMUTABLE_CACHE, "sha256": hashlib.sha256(data).hexdigest(),
                      "bytes": len(data)})
    return files


def release_html(source: str, commit: str, prefix: str = "EntregaEPI") -> str:
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or not re.fullmatch(r"[A-Za-z0-9_-]+", prefix):
        raise ValueError("Invalid release identifier or application prefix")
    html = source.replace("__APP_PREFIX__", prefix).replace("__BUILD_SHA__", commit)
    return html.replace(f"/{prefix}/assets/", f"/{prefix}/releases/{commit}/assets/")


def build(source: Path, stage: Path, commit: str, prefix: str = "EntregaEPI") -> dict:
    files = release_assets(source, stage, commit, prefix)
    html = release_html((source / "index.html").read_text(encoding="utf-8"), commit, prefix)
    (stage / "index.html").write_text(html, encoding="utf-8")
    files.append({"key": f"{prefix}/index.html", "file": "index.html", "cacheControl": FRESH_CACHE,
                  "sha256": hashlib.sha256(html.encode()).hexdigest(), "bytes": len(html.encode())})
    manifest = {"buildSha": commit, "files": files}
    (stage / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("frontend/EntregaEPI"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    manifest = build(args.source, args.output, args.commit)
    print(json.dumps({"buildSha": args.commit, "files": len(manifest["files"])}))


if __name__ == "__main__":
    main()
