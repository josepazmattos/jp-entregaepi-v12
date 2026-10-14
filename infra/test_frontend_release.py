import hashlib
from pathlib import Path
import tempfile
import unittest

from frontend_release import build, FRESH_CACHE, IMMUTABLE_CACHE


class ReleaseTests(unittest.TestCase):
    def test_versioned_assets_preserve_bytes_and_fresh_entrypoints(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            (source / "assets/vendor").mkdir(parents=True)
            (source / "assets/app.js").write_text("window.test = 1;")
            (source / "assets/vendor/module.mjs").write_text("export const value = 1;")
            (source / "assets/installer.exe").write_bytes(b"installer")
            (source / "index.html").write_text('<meta name="jp-build" content="__BUILD_SHA__">'
                '<script src="/__APP_PREFIX__/config.js"></script>'
                '<script src="/__APP_PREFIX__/assets/app.js"></script>'
                '<a href="/__APP_PREFIX__/updates/installer.exe">Instalar</a>')
            commit = "a" * 40
            manifest = build(source, root / "stage", commit)
            html = (root / "stage/index.html").read_text()
            self.assertIn(f"/EntregaEPI/releases/{commit}/assets/app.js", html)
            self.assertIn('/EntregaEPI/config.js', html)
            self.assertIn('/EntregaEPI/updates/installer.exe', html)
            self.assertEqual(len(manifest["files"]), 3)
            for file in manifest["files"]:
                self.assertEqual(hashlib.sha256((root / "stage" / file["file"]).read_bytes()).hexdigest(), file["sha256"])
                self.assertEqual(file["cacheControl"], FRESH_CACHE if file["file"] == "index.html" else IMMUTABLE_CACHE)
            (source / "assets/app.js").write_text("window.test = 2;")
            with self.assertRaisesRegex(ValueError, "overwritten"):
                build(source, root / "stage", commit)
            build(source, root / "stage", "b" * 40)
            self.assertEqual((root / f"stage/releases/{commit}/assets/app.js").read_text(), "window.test = 1;")

    def test_rejects_path_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            (root / "private.txt").write_text("private")
            (root / "assets/leak.txt").symlink_to(root / "private.txt")
            with self.assertRaises(ValueError):
                build(root, root / "out", "../invalid")
            with self.assertRaisesRegex(ValueError, "Symbolic"):
                build(root, root / "out", "a" * 40)


if __name__ == "__main__":
    unittest.main()
