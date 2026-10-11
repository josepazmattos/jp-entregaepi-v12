"""Reproduce vendor SDK initialization in an isolated Windows CI directory."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import urllib.request
import zipfile

from windows_complete_smoke import diagnose_sdk

assert os.name == 'nt' and os.environ.get('GITHUB_ACTIONS') == 'true'
repo = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo / 'native/setup-completo'))
from build_ci import SEED_URL, SEED_HASH

with urllib.request.urlopen(SEED_URL, timeout=60) as response:
    data = response.read(90 * 1024 * 1024)
assert hashlib.sha256(data).hexdigest() == SEED_HASH
with tempfile.TemporaryDirectory(prefix='jp-sdk-isolated-') as temporary:
    root = Path(temporary)
    home = root / 'JP/Biometria'
    home.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        for entry in manifest['files']:
            name = entry['name']
            if not name.startswith(('sdk/', 'jre/')):
                continue
            assert '\\' not in name and '..' not in name and ':' not in name
            content = archive.read(name)
            assert len(content) == entry['size'] and hashlib.sha256(content).hexdigest() == entry['sha256']
            base = home / 'sdk-5.2.0.6' if name.startswith('sdk/') else root / 'Programs/Eclipse Adoptium/jp-biometria-jre8u504b01'
            target = base / name[4:]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    previous = os.environ['LOCALAPPDATA']
    os.environ['LOCALAPPDATA'] = str(root)
    try:
        diagnose_sdk(home)
    finally:
        os.environ['LOCALAPPDATA'] = previous
