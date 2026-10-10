"""Build an offline installer from explicitly supplied, hash-pinned vendor files.

Vendor files and serials must never be added to this repository.
No serial or SDK development installer is included in the resulting runtime bundle.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent


def build(inputs, jre, agent, output, go):
    lock = json.loads((ROOT / 'vendor-lock.json').read_text())
    sources = json.loads(inputs.read_text())
    if set(sources) != set(lock) - {'jre.zip'}:
        raise ValueError('Vendor inventory does not match approved components')
    data = {}
    for name, path in sources.items():
        b = Path(path).read_bytes()
        if hashlib.sha256(b).hexdigest() != lock[name]:
            raise ValueError('Vendor checksum mismatch: ' + name)
        data[name] = b
    if hashlib.sha256(jre.read_bytes()).hexdigest() != lock['jre.zip']:
        raise ValueError('Java checksum mismatch')
    with zipfile.ZipFile(jre) as z:
        for f in z.infolist():
            if f.is_dir():
                continue
            parts = Path(f.filename).parts
            if len(parts) < 2 or '..' in parts or f.filename.startswith('/'):
                raise ValueError('Invalid Java archive path')
            name = 'jre/' + '/'.join(parts[1:])
            data[name] = z.read(f)
    if 'jre/bin/java.exe' not in data:
        raise ValueError('Java executable missing')
    data['agent.exe'] = agent.read_bytes()
    if not data['agent.exe'].startswith(b'MZ'):
        raise ValueError('Agent must be a Windows executable')
    manifest = {'version': '12.9.4', 'files': [
        {'name': n, 'size': len(b), 'sha256': hashlib.sha256(b).hexdigest()}
        for n, b in sorted(data.items())]}
    with zipfile.ZipFile(ROOT / 'payload.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for n, b in sorted(data.items()):
            z.writestr(n, b)
        z.writestr('manifest.json', json.dumps(manifest))
    subprocess.run([go, 'test', '-count=1', './...'], cwd=ROOT, check=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([go, 'build', '-trimpath', '-buildvcs=false', '-ldflags', '-s -w', '-o', str(output.resolve()), '.'],
                   cwd=ROOT, env=dict(os.environ, GOOS='windows', GOARCH='amd64', CGO_ENABLED='0'), check=True)
    b = output.read_bytes()
    print(json.dumps({'file': output.name, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest(),
                      'serialIncluded': False, 'physicalReaderTested': False}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inputs', required=True, type=Path)
    p.add_argument('--jre', required=True, type=Path)
    p.add_argument('--agent', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--go', required=True)
    a = p.parse_args()
    build(a.inputs, a.jre, a.agent, a.output, a.go)
