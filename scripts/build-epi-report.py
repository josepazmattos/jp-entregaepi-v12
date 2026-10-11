#!/usr/bin/env python3
"""Build the shared, read-only equipment catalog from a supplied RelatorioCA.

No database mutation. Existing registered equipment always takes precedence at
query time. Repeated laboratory rows are collapsed, conflicting CAs are flagged.
"""
import argparse
import csv
import gzip
import hashlib
import importlib.util
import io
import json
from collections import defaultdict
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location('ca_builder', Path(__file__).with_name('build-caepi-snapshot.py'))
ca_builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ca_builder)

COLUMNS = {'ca':'NR Registro CA', 'nomeCurto':'EQUIPAMENTO', 'fabricante':'RAZAO SOCIAL',
           'modelo':'REFERENCIA', 'descricao':'DESCRICAO EQUIPAMENTO',
           'validade':'DATA DE VALIDADE', 'situacao':'SITUACAO'}
def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

def parse(data):
    csv.field_size_limit(5 * 1024 * 1024)
    reader = csv.DictReader(io.StringIO(data.decode('utf-8-sig'), newline=''), delimiter=';')
    reader.fieldnames = [name.lstrip('\ufeff').strip() for name in reader.fieldnames or []]
    if not set(COLUMNS.values()).issubset(reader.fieldnames):
        raise ValueError('Colunas obrigatórias ausentes no RelatorioCA.')
    variants = defaultdict(dict)
    count = 0
    for number, row in enumerate(reader, 2):
        count += 1
        record = {field:(row.get(column) or '').strip() for field,column in COLUMNS.items()}
        if None in row or not re.fullmatch(r'[1-9][0-9]{0,7}', record['ca']) or not record['nomeCurto']:
            raise ValueError(f'Registro inválido na linha {number}.')
        limits = {'nomeCurto':160,'fabricante':500,'modelo':300,'descricao':5000,'validade':100,'situacao':300}
        if any(len(record[k]) > limit for k,limit in limits.items()):
            raise ValueError(f'Campo extenso demais na linha {number}.')
        variants[record['ca']][encoded(record)] = record
    records = []
    for ca, values in sorted(variants.items(), key=lambda x:int(x[0])):
        alternatives = list(values.values())
        if len(alternatives) == 1:
            records.append({**alternatives[0], 'ambiguous':False})
        else:
            common = lambda field: alternatives[0][field] if len({v[field] for v in alternatives}) == 1 else ''
            records.append({'ca':ca,'nomeCurto':common('nomeCurto') or f'Equipamento CA {ca}',
                            'fabricante':common('fabricante'),'modelo':common('modelo'),
                            'descricao':'','validade':'','situacao':'Conferir dados',
                            'ambiguous':True,'variants':alternatives})
    return records, count

def build(source, output, date):
    raw = source.read_bytes()
    csv_data, member = ca_builder.extract_gzip(raw)
    records, row_count = parse(csv_data)
    if len(records) < 10000:
        raise ValueError('Relatório inesperadamente pequeno; publicação interrompida.')
    source_hash = hashlib.sha256(raw).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    details = defaultdict(dict)
    index = []
    for record in records:
        ca = record['ca']
        index.append({k:v for k,v in record.items() if k not in ['descricao','variants']})
        details[str(int(ca)//1000)][ca] = {'descricao':record['descricao'], **({'variants':record['variants']} if record['ambiguous'] else {})}
    def save(name, value):
        data = gzip.compress(encoded(value), compresslevel=9, mtime=0)
        (output/name).write_bytes(data)
        return {'file':name,'sha256':hashlib.sha256(data).hexdigest(),'sizeBytes':len(data)}
    index_file = save('index.json.gz', index)
    shards = [dict(save(f'details-{bucket}.json.gz',value),bucket=bucket) for bucket,value in sorted(details.items(),key=lambda x:int(x[0]))]
    manifest = {'schemaVersion':1,'sourceKind':'uploaded-relatorio-ca','sourceFile':source.name,
                'sourceDate':date,'sourceSha256':source_hash,'sourceGzipSha256':hashlib.sha256(member).hexdigest(),
                'sourceRows':row_count,'total':len(records),'ambiguousTotal':sum(r['ambiguous'] for r in records),
                'idPrefix':f'relatorio-{source_hash[:12]}-','index':index_file,'shards':shards}
    (output/'manifest.json').write_bytes(encoded(manifest))
    return manifest

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--date',required=True)
    args=parser.parse_args()
    print(json.dumps(build(args.source,args.output,args.date),ensure_ascii=False))
