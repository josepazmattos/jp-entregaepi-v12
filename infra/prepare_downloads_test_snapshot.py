"""Test the scoped download addition against the actual published application."""
import argparse
import concurrent.futures
from html.parser import HTMLParser
from pathlib import Path
import shutil
import urllib.parse
import urllib.request
from patch_download_center import patch_html

ORIGIN = 'https://www.jptreinamentos.com.br'


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag not in ('script', 'link', 'img'):
            return
        value = attributes.get('src') or attributes.get('href', '')
        if value.startswith('/EntregaEPI/') and not value.endswith('.exe'):
            self.paths.add(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    destination = args.output.resolve()
    destination.mkdir(parents=True, exist_ok=True)

    def download(url):
        relative = urllib.parse.urlsplit(url).path.removeprefix('/EntregaEPI/')
        target = (destination / relative).resolve()
        if not target.is_relative_to(destination):
            raise ValueError('Unexpected asset path')
        with urllib.request.urlopen(ORIGIN + url, timeout=45) as response:
            data = response.read(4 * 1024 * 1024)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return target

    index = download('/EntregaEPI/index.html')
    source = index.read_text(encoding='utf-8')
    assets = Assets()
    assets.feed(source)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(download, sorted(assets.paths)))
    patched = patch_html(source)
    assert patch_html(patched) == patched
    index.write_text(patched, encoding='utf-8')
    release = destination / 'updates/downloads-20261023-1'
    release.mkdir(parents=True, exist_ok=True)
    for name in ['downloads-center.js', 'downloads-center.css']:
        shutil.copyfile(root / 'frontend/EntregaEPI/assets' / name, release / name)
    shutil.copyfile(root / 'frontend/EntregaEPI/downloads.html', destination / 'downloads.html')
    print('Prepared published application snapshot with scoped download assets.')


if __name__ == '__main__':
    main()

