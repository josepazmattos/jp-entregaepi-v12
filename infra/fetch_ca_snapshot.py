#!/usr/bin/env python3
"""Obtém a base pública CAEPI, presa ao SHA do arquivo data/caepi-source.json."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile


class SnapshotError(RuntimeError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_source(path):
    source = json.loads(Path(path).read_text(encoding="utf-8"))
    url = urllib.parse.urlparse(source.get("url", ""))
    if (url.scheme != "https" or url.hostname != "www.jptreinamentos.com.br"
            or not url.path.startswith("/EntregaEPI/caepi-snapshots/") or url.query or url.fragment
            or url.username or url.password):
        raise SnapshotError("Origem da cópia CAEPI não corresponde ao endereço público autorizado.")
    for field in ("sha256", "manifestSha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", source.get(field, "")):
            raise SnapshotError("Checksum da base CAEPI ausente ou inválido.")
    if not isinstance(source.get("sizeBytes"), int) or not 0 < source["sizeBytes"] <= 25 * 1024 * 1024:
        raise SnapshotError("Tamanho da base CAEPI fora do limite esperado.")
    if not isinstance(source.get("records"), int) or source["records"] < 1:
        raise SnapshotError("Quantidade de certificados da base CAEPI inválida.")
    return source


def read_manifest(data, source):
    if len(data) > 1024 * 1024 or digest(data) != source["manifestSha256"]:
        raise SnapshotError("Hash do manifesto CAEPI não confere.")
    manifest = json.loads(data)
    if (manifest.get("schemaVersion") != 1 or manifest.get("sourceKind") != "official-snapshot"
            or manifest.get("total") != source["records"]
            or manifest.get("ambiguousTotal") != source["ambiguousRecords"]
            or manifest.get("downloadedAt") != source["downloadedAt"]):
        raise SnapshotError("Manifesto CAEPI diverge da fonte fixada neste commit.")
    shards = manifest.get("shards", [])
    files, buckets = set(), set()
    if not shards or len(shards) > 1024:
        raise SnapshotError("Lista de partes da base CAEPI inválida.")
    for shard in shards:
        if (not re.fullmatch(r"ca-[0-9]+\.json\.gz", shard.get("file", ""))
                or not re.fullmatch(r"[0-9a-f]{64}", shard.get("sha256", ""))
                or not re.fullmatch(r"[0-9]+", str(shard.get("bucket", "")))
                or not isinstance(shard.get("count"), int) or not 0 < shard["count"] <= 1000
                or not isinstance(shard.get("sizeBytes"), int) or not 0 < shard["sizeBytes"] <= 8 * 1024 * 1024
                or shard["file"] in files or str(shard["bucket"]) in buckets):
            raise SnapshotError("Parte da base CAEPI inválida ou duplicada.")
        files.add(shard["file"])
        buckets.add(str(shard["bucket"]))
    if sum(item["count"] for item in shards) != source["records"]:
        raise SnapshotError("A soma das partes CAEPI não corresponde ao total declarado.")
    return manifest


def verify_installed(directory, source):
    directory = Path(directory)
    if directory.is_symlink():
        raise SnapshotError("A pasta da base CAEPI não pode ser um link simbólico.")
    manifest = read_manifest((directory / "manifest.json").read_bytes(), source)
    expected = {"manifest.json", *(item["file"] for item in manifest["shards"])}
    if {path.name for path in directory.iterdir()} != expected:
        raise SnapshotError("Arquivos inesperados na pasta da base CAEPI.")
    for shard in manifest["shards"]:
        path = directory / shard["file"]
        if path.is_symlink() or not path.is_file() or path.stat().st_size != shard["sizeBytes"]:
            raise SnapshotError("Tamanho de uma parte CAEPI não confere.")
        raw = path.read_bytes()
        if digest(raw) != shard["sha256"]:
            raise SnapshotError("Checksum de uma parte CAEPI não confere.")
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            uncompressed = stream.read(16 * 1024 * 1024 + 1)
        if len(uncompressed) > 16 * 1024 * 1024:
            raise SnapshotError("Parte CAEPI ultrapassa o limite após descompressão.")
        payload = json.loads(uncompressed)
        items = payload if isinstance(payload, list) else payload.get("items", {})
        if not isinstance(items, (list, dict)) or len(items) != shard["count"]:
            raise SnapshotError("Quantidade de registros em uma parte CAEPI não confere.")
    return manifest


def extract_verified(archive_path, source, destination):
    archive_path, destination = Path(archive_path), Path(destination)
    raw = archive_path.read_bytes()
    if len(raw) != source["sizeBytes"] or digest(raw) != source["sha256"]:
        raise SnapshotError("Tamanho ou SHA256 do ZIP CAEPI não corresponde ao commit.")
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(set(names)) != len(names) or "manifest.json" not in names:
            raise SnapshotError("Arquivo ZIP contém nomes duplicados ou não tem manifesto.")
        for entry in entries:
            if (not re.fullmatch(r"manifest\.json|ca-[0-9]+\.json\.gz", entry.filename)
                    or entry.is_dir() or stat.S_ISLNK(entry.external_attr >> 16)
                    or entry.flag_bits & 1 or entry.file_size > 8 * 1024 * 1024):
                raise SnapshotError("Arquivo ZIP contém caminho ou tipo de arquivo não permitido.")
        manifest = read_manifest(archive.read("manifest.json"), source)
        expected = {"manifest.json", *(item["file"] for item in manifest["shards"])}
        if set(names) != expected or sum(entry.file_size for entry in entries) > 64 * 1024 * 1024:
            raise SnapshotError("Conteúdo do ZIP não corresponde ao manifesto CAEPI.")
        for entry in entries:
            target = destination / entry.filename
            target.write_bytes(archive.read(entry))
            target.chmod(0o644)
    return verify_installed(destination, source)


def install(root):
    root = Path(root)
    source = read_source(root / "data/caepi-source.json")
    destination = root / "backend/src/data/caepi"
    if destination.exists():
        try:
            manifest = verify_installed(destination, source)
            print(f"CAEPI verificado: {manifest['total']} registros; manifesto {source['manifestSha256']}.")
            return
        except (SnapshotError, OSError, ValueError):
            pass
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="caepi-build-", dir=destination.parent) as temporary:
        work = Path(temporary)
        archive = work / "snapshot.zip"
        request = urllib.request.Request(source["url"], headers={"Accept-Encoding": "identity"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as stream:
                final = urllib.parse.urlparse(response.geturl())
                if final.scheme != "https" or final.hostname != "www.jptreinamentos.com.br":
                    raise SnapshotError("Download da base CAEPI foi redirecionado para outro domínio.")
                total = 0
                while block := response.read(1024 * 1024):
                    total += len(block)
                    if total > source["sizeBytes"]:
                        raise SnapshotError("Download CAEPI ultrapassou o tamanho fixado.")
                    stream.write(block)
        except urllib.error.URLError:
            raise SnapshotError("Não foi possível baixar a cópia pública CAEPI fixada no commit.") from None
        prepared = work / "prepared"
        manifest = extract_verified(archive, source, prepared)
        old = work / "previous"
        if destination.exists():
            os.replace(destination, old)
        try:
            os.replace(prepared, destination)
        except OSError:
            if old.exists():
                os.replace(old, destination)
            raise
        if old.exists():
            shutil.rmtree(old)
    print(f"CAEPI preparado: {manifest['total']} registros; ZIP SHA256 {source['sha256']}.")


def main():
    try:
        install(Path(__file__).resolve().parents[1])
        return 0
    except (SnapshotError, OSError, ValueError, zipfile.BadZipFile) as error:
        message = str(error) if isinstance(error, SnapshotError) else "Não foi possível validar a base CAEPI."
        print("ERRO: " + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
