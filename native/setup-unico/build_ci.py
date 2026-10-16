"""Rebuild the unified installer, preserving every published vendor byte."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
VERSION = '12.10.1-unico1'
FILENAME = 'JP-Biometria-Instalador-Unico.exe'
BASE_URL = 'https://www.jptreinamentos.com.br/EntregaEPI/updates/12.10.0-unico1/' + FILENAME
BASE_SHA = 'd8773cc34e0bcb4cbdb4a3120f7654cdcff7707a4f005343106d0625c48d4d3b'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--build-sha', required=True)
    a = p.parse_args()
    assert re.fullmatch('[0-9a-f]{40}', a.build_sha)
    with urllib.request.urlopen(BASE_URL, timeout=120) as r:
        original = r.read(100 * 1024 * 1024)
    assert sha(original) == BASE_SHA, 'Published installer integrity failed'
    with zipfile.ZipFile(io.BytesIO(original)) as z:
        m = json.loads(z.read('manifest.json'))
        assert m['version'] == '12.10.0-unico1'
        names = [f['name'] for f in m['files']]
        assert len(set(names)) == len(names)
        assert sorted(z.namelist()) == sorted(names + ['manifest.json'])
        entries = {}
        for f in m['files']:
            name = f['name']
            assert '\\' not in name and ':' not in name and not name.startswith('/')
            assert '..' not in PurePosixPath(name).parts
            data = z.read(name)
            assert len(data) == f['size'] and sha(data) == f['sha256']
            if name != 'agent.exe':
                entries[name] = data
    vendor_hashes = {name: sha(data) for name, data in entries.items()}
    a.output.mkdir(parents=True, exist_ok=True)
    agent_dir = a.output / 'agent'
    subprocess.run([sys.executable, str(ROOT.parent / 'biometria/build.py'),
                    '--output', str(agent_dir), '--build-sha', a.build_sha], check=True)
    agent_manifest = json.loads((agent_dir / 'biometria-release.json').read_text())
    entries['agent.exe'] = (agent_dir / agent_manifest['filename']).read_bytes()
    assert sha(entries['agent.exe']) == agent_manifest['sha256']
    manifest = {'version': VERSION, 'files': [
        {'name': n, 'size': len(b), 'sha256': sha(b)} for n, b in sorted(entries.items())]}
    entries['manifest.json'] = json.dumps(manifest, sort_keys=True).encode()
    with zipfile.ZipFile(ROOT / 'payload.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for n, b in sorted(entries.items()):
            info = zipfile.ZipInfo(n, (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, b)
    go = os.environ.get('GO_BIN') or shutil.which('go')
    subprocess.run([go, 'test', '-count=1', './...'], cwd=ROOT, check=True)
    out = a.output.resolve() / FILENAME
    subprocess.run([go, 'build', '-trimpath', '-buildvcs=false', '-ldflags', '-s -w -buildid=',
                    '-o', str(out), '.'], cwd=ROOT,
                   env=dict(os.environ, GOOS='windows', GOARCH='386', CGO_ENABLED='0'), check=True)
    with out.open('ab') as f:
        f.write((ROOT / 'payload.zip').read_bytes())
    with zipfile.ZipFile(out) as z:
        assert all(sha(z.read(n)) == h for n, h in vendor_hashes.items())
    release = {'version': VERSION, 'agentVersion': agent_manifest['version'], 'buildSha': a.build_sha,
               'filename': FILENAME, 'sha256': sha(out.read_bytes()), 'sizeBytes': out.stat().st_size,
               'baseInstallerSha256': BASE_SHA, 'vendorBytesUnchanged': True,
               'silentStartup': True, 'physicalReaderTested': False}
    (a.output / 'release.json').write_text(json.dumps(release, indent=2) + '\n')
    print(json.dumps(release))


if __name__ == '__main__':
    main()
