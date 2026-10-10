"""Build the complete installer using pinned runtime inputs and the current JP agent."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
SEED_URL = 'https://www.jptreinamentos.com.br/EntregaEPI/build-inputs/biometria-runtime-d821d5dc.zip'
SEED_HASH = 'd821d5dc768a51f741fd322d480f851058b39429356d1df13aa84e216bccccf9'
FILENAME = 'JP-Biometria-Completo-12.9.4.exe'


def build(agent, output, commit):
    source = ROOT / 'payload-seed.zip'
    with urllib.request.urlopen(SEED_URL, timeout=90) as r:
        b = r.read(90 * 1024 * 1024)
    if hashlib.sha256(b).hexdigest() != SEED_HASH:
        raise ValueError('Runtime seed integrity failed')
    source.write_bytes(b)
    with zipfile.ZipFile(source) as z:
        m = json.loads(z.read('manifest.json'))
        data = {item['name']: z.read(item['name']) for item in m['files']}
        for item in m['files']:
            content = data[item['name']]
            if len(content) != item['size'] or hashlib.sha256(content).hexdigest() != item['sha256']:
                raise ValueError('Runtime component integrity failed')
    data['agent.exe'] = agent.read_bytes()
    m['files'] = [{'name': n, 'size': len(v), 'sha256': hashlib.sha256(v).hexdigest()} for n, v in sorted(data.items())]
    with zipfile.ZipFile(ROOT / 'payload.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for n, v in sorted(data.items()):
            i = zipfile.ZipInfo(n, date_time=(2020, 1, 1, 0, 0, 0)); i.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(i, v)
        i = zipfile.ZipInfo('manifest.json', date_time=(2020, 1, 1, 0, 0, 0)); i.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(i, json.dumps(m, sort_keys=True))
    go = os.environ.get('GO_BIN') or shutil.which('go')
    subprocess.run([go, 'test', '-count=1', './...'], cwd=ROOT, check=True)
    output.mkdir(parents=True, exist_ok=True)
    exe = output / FILENAME
    subprocess.run([go, 'build', '-trimpath', '-buildvcs=false', '-ldflags', '-s -w -buildid=', '-o', str(exe.resolve()), '.'],
                   cwd=ROOT, env=dict(os.environ, GOOS='windows', GOARCH='amd64', CGO_ENABLED='0'), check=True)
    manifest = {'version': '12.9.4', 'buildSha': commit, 'filename': FILENAME,
                'sizeBytes': exe.stat().st_size, 'sha256': hashlib.sha256(exe.read_bytes()).hexdigest(),
                'platform': 'windows-amd64', 'reader': 'NITGEN FingKey Hamster DX HFDU06', 'serialIncluded': False}
    (output / 'biometria-complete-release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    source.unlink()
    print(json.dumps(manifest))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--agent', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--commit', required=True)
    a = p.parse_args()
    build(a.agent, a.output, a.commit)
