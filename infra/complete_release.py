"""Verify and stage the exact complete installer tested on Windows."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

FILENAME = 'JP-Biometria-Completo-12.9.4.exe'
MANIFEST = 'biometria-complete-release.json'


def verify(source, commit, destination=None):
    m = json.loads((source / MANIFEST).read_text())
    b = (source / FILENAME).read_bytes()
    if not (m.get('buildSha') == commit and m.get('version') == '12.9.4' and m.get('filename') == FILENAME
            and m.get('sizeBytes') == len(b) and 1024 < len(b) < 100 * 1024 * 1024 and b[:2] == b'MZ'
            and m.get('sha256') == hashlib.sha256(b).hexdigest()):
        raise ValueError('Complete installer does not match the tested commit/artifact')
    if destination:
        destination.mkdir(parents=True, exist_ok=True)
        for name in (FILENAME, MANIFEST):
            shutil.copyfile(source / name, destination / name)
    return m


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--destination', type=Path)
    p.add_argument('--commit', required=True)
    a = p.parse_args()
    print(json.dumps(verify(a.source, a.commit, a.destination)))
