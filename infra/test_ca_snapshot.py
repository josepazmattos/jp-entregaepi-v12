"""Testes locais de integridade e extração; nenhuma consulta à internet."""
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import fetch_ca_snapshot as snapshot


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.shard = gzip.compress(json.dumps({"items": [{"ca": "365", "name": "EXEMPLO SINTÉTICO"}]}).encode())
        self.manifest = {"schemaVersion": 1, "sourceKind": "official-snapshot", "total": 1,
            "ambiguousTotal": 0, "downloadedAt": "2026-10-06T00:00:00Z", "shards": [{"bucket": "0",
            "file": "ca-000.json.gz", "sha256": hashlib.sha256(self.shard).hexdigest(), "count": 1,
            "sizeBytes": len(self.shard)}]}
        self.raw_manifest = json.dumps(self.manifest).encode()
        self.source = {"url": "https://www.jptreinamentos.com.br/EntregaEPI/caepi-snapshots/fixture.zip",
            "records": 1, "ambiguousRecords": 0, "downloadedAt": self.manifest["downloadedAt"],
            "manifestSha256": hashlib.sha256(self.raw_manifest).hexdigest()}

    def archive(self, extras=None):
        path = self.root / "fixture.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("manifest.json", self.raw_manifest)
            archive.writestr("ca-000.json.gz", self.shard)
            for name, body in (extras or {}).items():
                archive.writestr(name, body)
        self.source.update(sizeBytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        return path

    def test_extracts_only_hash_verified_manifest_and_shards(self):
        archive = self.archive()
        destination = self.root / "caepi"
        result = snapshot.extract_verified(archive, self.source, destination)
        self.assertEqual(result["total"], 1)
        self.assertEqual({p.name for p in destination.iterdir()}, {"manifest.json", "ca-000.json.gz"})
        self.assertEqual(snapshot.verify_installed(destination, self.source)["sourceKind"], "official-snapshot")

    def test_modified_zip_and_modified_installed_shard_are_rejected(self):
        archive = self.archive()
        destination = self.root / "caepi"
        snapshot.extract_verified(archive, self.source, destination)
        (destination / "ca-000.json.gz").write_bytes(b"ARQUIVO ALTERADO")
        with self.assertRaises(snapshot.SnapshotError):
            snapshot.verify_installed(destination, self.source)
        archive.write_bytes(archive.read_bytes() + b"ALTERACAO")
        with self.assertRaisesRegex(snapshot.SnapshotError, "SHA256"):
            snapshot.extract_verified(archive, self.source, self.root / "new")
        self.assertFalse((self.root / "new").exists())

    def test_path_traversal_is_rejected_even_with_a_matching_zip_hash(self):
        archive = self.archive({"../outside.txt": b"CONTEUDO NAO PERMITIDO"})
        with self.assertRaisesRegex(snapshot.SnapshotError, "caminho"):
            snapshot.extract_verified(archive, self.source, self.root / "caepi")
        self.assertFalse((self.root / "outside.txt").exists())

    def test_source_cannot_redirect_build_to_an_arbitrary_download(self):
        self.archive()
        source_file = self.root / "source.json"
        source_file.write_text(json.dumps({**self.source, "url": "https://other.example/snapshot.zip"}))
        with self.assertRaisesRegex(snapshot.SnapshotError, "Origem"):
            snapshot.read_source(source_file)


if __name__ == "__main__":
    unittest.main()
