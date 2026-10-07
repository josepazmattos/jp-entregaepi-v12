"""Verify the Windows companion built by this workflow before publishing it."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

AGENT_VERSION = "12.8.3"
EXECUTABLE = "JP-Biometria-Setup-12.8.3.exe"
MANIFEST = "biometria-release.json"
MAX_EXECUTABLE_BYTES = 20 * 1024 * 1024


class ReleaseError(ValueError):
    """Public diagnostic; does not include credentials or local account paths."""


def require(value, message):
    if not value:
        raise ReleaseError(message)


def verify_release(directory: Path, commit: str) -> dict:
    require(isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}", commit), "Commit do componente local inválido.")
    manifest_path, executable = directory / MANIFEST, directory / EXECUTABLE
    require(manifest_path.is_file() and not manifest_path.is_symlink(), "Manifesto do componente local ausente.")
    require(0 < manifest_path.stat().st_size <= 16384, "Manifesto do componente local inválido.")
    try:
        manifest = json.loads(manifest_path.read_bytes())
    except (ValueError, UnicodeError):
        raise ReleaseError("Manifesto do componente local não contém JSON válido.") from None
    require(isinstance(manifest, dict), "Manifesto do componente local inválido.")
    require(manifest.get("version") == AGENT_VERSION and manifest.get("filename") == EXECUTABLE,
            "O componente local não corresponde à versão esperada.")
    require(manifest.get("buildSha") == commit, "O componente local não foi compilado a partir do commit aprovado.")
    size, checksum = manifest.get("sizeBytes"), manifest.get("sha256")
    require(type(size) is int and 256 <= size <= MAX_EXECUTABLE_BYTES
            and isinstance(checksum, str) and re.fullmatch(r"[0-9a-f]{64}", checksum),
            "Tamanho ou hash do componente local inválido.")
    require(executable.is_file() and not executable.is_symlink() and executable.stat().st_size == size,
            "Executável do componente local ausente ou incompleto.")
    digest = hashlib.sha256()
    with executable.open("rb") as source:
        prefix = source.read(64)
        require(len(prefix) == 64 and prefix[:2] == b"MZ", "O componente não é um executável Windows.")
        pe_offset = int.from_bytes(prefix[60:64], "little")
        require(64 <= pe_offset <= size - 26, "Cabeçalho Windows inválido.")
        source.seek(pe_offset)
        header = source.read(26)
        require(header[:4] == b"PE\0\0" and header[4:6] == b"\x64\x86"
                and header[24:26] == b"\x0b\x02", "O componente não corresponde ao Windows de 64 bits.")
        source.seek(0)
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    require(digest.hexdigest() == checksum, "O hash do componente local diverge do artefato testado.")
    return manifest


def prepare_release(source: Path, destination: Path, commit: str) -> dict:
    manifest = verify_release(source, commit)
    destination.mkdir(parents=True, exist_ok=True)
    for name in (EXECUTABLE, MANIFEST):
        target = destination / name
        require(not target.is_symlink(), "Destino do componente local inválido.")
        if (source / name).resolve() != target.resolve():
            temporary = destination / (name + ".preparing")
            require(not temporary.is_symlink(), "Destino temporário do componente local inválido.")
            try:
                shutil.copyfile(source / name, temporary)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
    verify_release(destination, commit)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    try:
        result = (prepare_release(args.source, args.destination, args.commit) if args.destination
                  else verify_release(args.source, args.commit))
    except (ReleaseError, OSError) as error:
        print(str(error) if isinstance(error, ReleaseError) else "Não foi possível preparar o componente local.", file=sys.stderr)
        return 1
    print(json.dumps({"verified": True, **{key: result[key] for key in
        ("version", "buildSha", "filename", "sha256", "sizeBytes")}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
