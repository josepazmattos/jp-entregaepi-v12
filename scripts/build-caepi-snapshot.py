#!/usr/bin/env python3
"""Build a reproducible CAEPI snapshot from the official downloaded CSV.GZ.

Usage: python scripts/build-caepi-snapshot.py --response /path/response.bin
       --metadata /path/metadata.json --output /path/output
No upload or AWS mutation is performed by this command.
"""
import argparse
from collections import defaultdict
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile
import zlib


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def extract_gzip(raw):
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    data = decoder.decompress(raw, 350 * 1024 * 1024)
    if not decoder.eof or decoder.unconsumed_tail:
        raise ValueError('Official gzip is incomplete or exceeds the 350 MiB limit.')
    extra = decoder.unused_data
    # The official ASP.NET download appends its HTML page after the complete gzip.
    # zlib verifies the complete member and CRC; no HTML is imported into the data.
    if extra.strip() and not extra.lstrip().lower().startswith((b'<!doctype html', b'<html')):
        raise ValueError('Unexpected bytes after the official gzip member.')
    return data, raw[:len(raw) - len(extra)] if extra else raw


def read_records(data):
    csv.field_size_limit(5 * 1024 * 1024)
    reader = csv.DictReader(io.StringIO(data.decode('utf-8-sig'), newline=''), delimiter=';')
    reader.fieldnames = [name.lstrip('\ufeff').strip() for name in reader.fieldnames]
    columns = {'ca': 'NR Registro CA', 'name': 'EQUIPAMENTO', 'description': 'DESCRICAO EQUIPAMENTO', 'manufacturer': 'RAZAO SOCIAL', 'status': 'SITUACAO', 'validity': 'DATA DE VALIDADE', 'obs': 'OBSERVACAO ANALISE LAUDO'}
    if not set(columns.values()).issubset(reader.fieldnames):
        raise ValueError('Unexpected CAEPI columns; review the source format.')
    variants = defaultdict(dict)
    row_count = 0
    for number, row in enumerate(reader, 2):
        row_count += 1
        item = {key: (row.get(column) or '').strip() for key, column in columns.items()}
        if None in row or not re.fullmatch(r'[1-9][0-9]{0,7}', item['ca']):
            raise ValueError(f'Invalid source record at CSV row {number}.')
        variants[item['ca']][compact(item)] = item
    records = []
    ambiguous = []
    for ca, candidates in sorted(variants.items(), key=lambda pair: int(pair[0])):
        values = list(candidates.values())
        if len(values) == 1:
            records.append(values[0])
            continue
        ambiguous.append(ca)
        names = {v['name'] for v in values}
        manufacturers = {v['manufacturer'] for v in values}
        records.append({'ca': ca, 'name': next(iter(names)) if len(names) == 1 else 'Registro com informações divergentes', 'description': '', 'manufacturer': next(iter(manufacturers)) if len(manufacturers) == 1 else '', 'status': 'Conferir no MTE', 'validity': '', 'obs': '', 'ambiguous': True, 'variantCount': len(values), 'sourceStatuses': sorted({v['status'] for v in values}), 'warning': 'A base oficial contém registros divergentes para este CA. Confira no portal do MTE antes do preenchimento.'})
    if len(records) < 10000:
        raise ValueError('Snapshot unexpectedly small; no deployment data produced.')
    return records, row_count, ambiguous


def build_snapshot(response, metadata, output):
    raw = response.read_bytes()
    source = json.loads(metadata.read_text(encoding='utf-8'))
    if source.get('url') != 'https://caepi.trabalho.gov.br/internet/ConsultaCAInternet.aspx' or source.get('status') != 200:
        raise ValueError('Source metadata does not identify the official successful download.')
    if hashlib.sha256(raw).hexdigest() != source.get('sha256'):
        raise ValueError('Source response does not match its recorded SHA-256.')
    csv_data, gzip_member = extract_gzip(raw)
    records, row_count, ambiguous = read_records(csv_data)
    output.mkdir(parents=True, exist_ok=True)
    snapshot = output / 'caepi'
    snapshot.mkdir(exist_ok=True)
    grouped = defaultdict(list)
    for item in records:
        grouped[str(int(item['ca']) // 1000)].append(item)
    files = []
    for bucket in sorted(grouped, key=int):
        name = f'ca-{int(bucket):03d}.json.gz'
        data = gzip.compress(compact(grouped[bucket]), compresslevel=9, mtime=0)
        (snapshot / name).write_bytes(data)
        files.append({'bucket': bucket, 'file': name, 'sha256': hashlib.sha256(data).hexdigest(), 'count': len(grouped[bucket]), 'sizeBytes': len(data)})
    source_file = source['contentDisposition'].split('filename=')[-1].strip('"')
    manifest = {'schemaVersion': 1, 'sourceKind': 'official-snapshot', 'sourceUrl': source['url'], 'sourceFile': source_file, 'downloadedAt': source['downloadedAt'], 'sourceUpdatedAt': None, 'sourceResponseSha256': source['sha256'], 'sourceGzipSha256': hashlib.sha256(gzip_member).hexdigest(), 'sourceCsvSha256': hashlib.sha256(csv_data).hexdigest(), 'total': len(records), 'sourceRows': row_count, 'ambiguousTotal': len(ambiguous), 'ambiguousCas': ambiguous, 'shardSize': 1000, 'shards': files}
    (snapshot / 'manifest.json').write_bytes(compact(manifest))
    archive = output / 'caepi-snapshot.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as z:
        for file in sorted(snapshot.iterdir()):
            entry = zipfile.ZipInfo(file.name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.external_attr = 0o644 << 16
            z.writestr(entry, file.read_bytes())
    sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    dated = source['downloadedAt'][:10].replace('-', '')
    final = output / f'caepi-oficial-{dated}-{sha[:12]}.zip'
    archive.replace(final)
    canonical_source = output / source_file
    canonical_source.write_bytes(gzip_member)
    result = {'filename': final.name, 'sha256': sha, 'sizeBytes': final.stat().st_size, 'records': len(records), 'sourceRows': row_count, 'ambiguousRecords': len(ambiguous), 'ambiguousCas': ambiguous, 'shards': len(files), 'largestShardBytes': max(x['sizeBytes'] for x in files), 'manifestSha256': hashlib.sha256((snapshot / 'manifest.json').read_bytes()).hexdigest(), 'sourceFile': source_file, 'sourceGzipSha256': manifest['sourceGzipSha256'], 'sourceGzipBytes': len(gzip_member), 'downloadedAt': manifest['downloadedAt'], 'sourceUrl': manifest['sourceUrl']}
    (output / 'snapshot-build.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--response', required=True, type=Path)
    parser.add_argument('--metadata', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build_snapshot(args.response, args.metadata, args.output), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
