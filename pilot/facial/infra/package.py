"""Create a deterministic local artifact. This script never uploads or deploys."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
bundle = root / 'dist/lambda'
required = ['index.mjs', 'font.ttf', 'font-bold.ttf']
for name in required:
    if not (bundle / name).is_file():
        raise SystemExit('Run npm run build first.')
target = root / 'dist/lambda.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in required:
        item = zipfile.ZipInfo(name, (2026, 10, 30, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        item.external_attr = 0o100644 << 16
        archive.writestr(item, (bundle / name).read_bytes())
sha = hashlib.sha256(target.read_bytes()).hexdigest()
manifest = {'artifact': str(target), 'bytes': target.stat().st_size, 'sha256': sha,
            'proposedBucket': 'jp-sst-deploy-003020057405-sa-east-1',
            'proposedKey': f'facial-pilot/20261030/{sha}.zip', 'uploaded': False}
(root / 'dist/package.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
