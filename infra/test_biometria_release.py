"""Publication gate tests. The PE header is synthetic and is never executed."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import biometria_release as release


class BiometriaReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.commit = "a" * 40
        self.binary = bytearray(512)
        self.binary[:2] = b"MZ"
        self.binary[60:64] = (128).to_bytes(4, "little")
        self.binary[128:134] = b"PE\0\0\x64\x86"
        self.binary[152:154] = b"\x0b\x02"
        self.executable = self.source / release.EXECUTABLE
        self.manifest_path = self.source / release.MANIFEST
        self.manifest = {"version": release.AGENT_VERSION, "buildSha": self.commit,
            "filename": release.EXECUTABLE, "sizeBytes": len(self.binary),
            "sha256": hashlib.sha256(self.binary).hexdigest()}
        self.executable.write_bytes(self.binary)
        self.write_manifest()

    def write_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_verified_release_copies_only_public_files(self):
        (self.source / "private-test-log.txt").write_text("SYNTHETIC-NOT-PUBLIC")
        destination = self.root / "assets"
        result = release.prepare_release(self.source, destination, self.commit)
        self.assertEqual(result, self.manifest)
        self.assertEqual({p.name for p in destination.iterdir()}, {release.EXECUTABLE, release.MANIFEST})
        self.assertEqual((destination / release.EXECUTABLE).read_bytes(), self.binary)
        self.assertEqual(release.verify_release(destination, self.commit), self.manifest)
        release.prepare_release(destination, destination, self.commit)

    def test_wrong_commit_version_or_filename_is_never_copied(self):
        for field, value in (("buildSha", "b" * 40), ("version", "11.10.6"),
                             ("filename", "../another.exe")):
            with self.subTest(field=field):
                original = self.manifest[field]
                self.manifest[field] = value
                self.write_manifest()
                destination = self.root / field
                with self.assertRaises(release.ReleaseError):
                    release.prepare_release(self.source, destination, self.commit)
                self.assertFalse(destination.exists())
                self.manifest[field] = original

    def test_corruption_size_and_missing_binary_are_rejected(self):
        self.executable.write_bytes(self.binary[:-1] + b"X")
        with self.assertRaisesRegex(release.ReleaseError, "hash"):
            release.verify_release(self.source, self.commit)
        self.executable.write_bytes(self.binary[:-1])
        with self.assertRaisesRegex(release.ReleaseError, "incompleto"):
            release.verify_release(self.source, self.commit)
        self.executable.unlink()
        with self.assertRaisesRegex(release.ReleaseError, "ausente"):
            release.verify_release(self.source, self.commit)

    def test_hash_alone_does_not_allow_html_or_wrong_windows_architecture(self):
        for offset, data in ((0, b"<!"), (128, b"HTML"), (132, b"\x4c\x01"),
                             (152, b"\x0b\x01"), (60, (500).to_bytes(4, "little"))):
            with self.subTest(offset=offset):
                modified = self.binary.copy()
                modified[offset:offset + len(data)] = data
                self.executable.write_bytes(modified)
                self.manifest["sha256"] = hashlib.sha256(modified).hexdigest()
                self.write_manifest()
                with self.assertRaises(release.ReleaseError):
                    release.verify_release(self.source, self.commit)

    def test_manifest_types_and_limits_are_checked(self):
        original = self.manifest.copy()
        for field, value in (("sizeBytes", True), ("sizeBytes", 1),
                             ("sizeBytes", release.MAX_EXECUTABLE_BYTES + 1),
                             ("sha256", "A" * 64), ("sha256", None)):
            with self.subTest(field=field, value=value):
                self.manifest = {**original, field: value}
                self.write_manifest()
                with self.assertRaises(release.ReleaseError):
                    release.verify_release(self.source, self.commit)
        for invalid in ("[]", "null", "{", " " * 16385):
            with self.subTest(invalid=invalid[:20]):
                self.manifest_path.write_text(invalid)
                with self.assertRaises(release.ReleaseError):
                    release.verify_release(self.source, self.commit)

    def test_source_and_destination_symlinks_are_rejected(self):
        actual = self.root / "actual.exe"
        self.executable.rename(actual)
        self.executable.symlink_to(actual)
        with self.assertRaises(release.ReleaseError):
            release.verify_release(self.source, self.commit)
        self.executable.unlink()
        actual.rename(self.executable)
        destination = self.root / "assets"
        destination.mkdir()
        outside = self.root / "outside.txt"
        outside.write_text("PRESERVAR")
        for name in (release.EXECUTABLE, release.EXECUTABLE + ".preparing"):
            target = destination / name
            target.symlink_to(outside)
            with self.assertRaises(release.ReleaseError):
                release.prepare_release(self.source, destination, self.commit)
            self.assertEqual(outside.read_text(), "PRESERVAR")
            target.unlink()


if __name__ == "__main__":
    unittest.main()
