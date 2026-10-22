"""Add the shared download center without replacing existing release references."""
import argparse
import re
from pathlib import Path

RELEASE = '/EntregaEPI/updates/downloads-20261022-1/'


def patch_html(source: str, build_sha: str | None = None) -> str:
    if source.count('id="downloadsBiometria"') != 1:
        raise ValueError('Expected one existing download section')
    if source.count('</head>') != 1 or source.count('</body>') != 1:
        raise ValueError('Invalid application HTML')
    css = f'  <link rel="stylesheet" href="{RELEASE}downloads-center.css">\n'
    js = f'  <script defer src="{RELEASE}downloads-center.js"></script>\n'
    if 'downloads-center.css' not in source:
        source = source.replace('</head>', css + '</head>')
    if 'downloads-center.js' not in source:
        source = source.replace('</body>', js + '</body>')
    if build_sha is not None:
        if not re.fullmatch(r'[a-f0-9]{40}', build_sha):
            raise ValueError('Invalid build SHA')
        source, count = re.subn(r'(<meta name="jp-build" content=")[^"]*("\s*/?>)', lambda m: m[1] + build_sha + m[2], source)
        if count != 1:
            raise ValueError('Expected one build marker')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--build-sha')
    args = parser.parse_args()
    source = args.input.read_text(encoding='utf-8')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(patch_html(source, args.build_sha), encoding='utf-8')


if __name__ == '__main__':
    main()
