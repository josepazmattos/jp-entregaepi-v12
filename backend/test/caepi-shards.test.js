import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createSnapshotReader } from '../src/services/caepi.reader.js';
import { normalizeDatabase, presentCA } from '../src/services/caepi.service.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'caepi-synthetic-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const shards = [];
  for (let bucket = 0; bucket < 5; bucket++) {
    const payload = [{ ca: String(bucket * 1000 + 365), name: `EPI SINTÉTICO ${bucket}`, manufacturer: 'FABRICANTE SINTÉTICO', status: 'Válido', validity: '09/01/2028', ...(bucket === 4 ? { ambiguous: true, variantCount: 2, sourceStatuses: ['Válido', 'Cancelado'] } : {}) }];
    const bytes = gzipSync(JSON.stringify(payload));
    const file = `ca-${String(bucket).padStart(3, '0')}.json.gz`;
    writeFileSync(join(directory, file), bytes);
    shards.push({ bucket: String(bucket), file, sha256: createHash('sha256').update(bytes).digest('hex'), count: 1 });
  }
  const metadata = { schemaVersion: 1, sourceKind: 'official-snapshot', sourceUrl: 'https://caepi.trabalho.gov.br/internet/ConsultaCAInternet.aspx', downloadedAt: '2026-10-06T23:53:59Z', sourceUpdatedAt: null, total: 5, shards };
  const filePath = join(directory, 'manifest.json');
  writeFileSync(filePath, JSON.stringify(metadata));
  return { directory, filePath, metadata };
}

test('consulta carrega shard correspondente; pesquisa atravessa shards sem carregar base inteira', t => {
  const { filePath } = fixture(t);
  const reader = createSnapshotReader({ filePath, normalize: normalizeDatabase });
  assert.equal(reader.status().total, 5);
  assert.equal(reader.status().mode, 'official-shards');
  const item = presentCA(reader.get('2365'));
  assert.equal(item.officialSnapshot, true);
  assert.equal(item.live, false);
  assert.equal(item.downloadedAt, '2026-10-06T23:53:59Z');
  assert.equal(item.sourceUpdatedAt, null);
  assert.deepEqual(reader.search(item => item.name.includes('3'), 50).map(item => item.ca), ['3365']);
  assert.equal(reader.get('9999999999'), null);
});

test('LRU mantém no máximo quatro shards e valida SHA ao recarregar arquivo removido do cache', t => {
  const { directory, filePath } = fixture(t);
  const reader = createSnapshotReader({ filePath, normalize: normalizeDatabase });
  assert.equal(reader.get('365').ca, '365');
  writeFileSync(join(directory, 'ca-000.json.gz'), gzipSync('[]'));
  assert.equal(reader.get('365').ca, '365');
  for (let bucket = 1; bucket < 5; bucket++) reader.get(String(bucket * 1000 + 365));
  assert.throws(() => reader.get('365'), error => error.status === 503 && error.code === 'CAEPI_BASE_INDISPONIVEL');
  assert.equal(reader.status().available, false);
});

test('registros oficiais divergentes não preenchem campos automaticamente', t => {
  const { filePath } = fixture(t);
  const reader = createSnapshotReader({ filePath, normalize: normalizeDatabase });
  const item = presentCA(reader.get('4365'));
  assert.equal(item.ambiguous, true);
  assert.equal(item.found, false);
  assert.equal(item.autofillAllowed, false);
  assert.equal(item.requiresOfficialConfirmation, true);
  for (const field of ['name', 'description', 'manufacturer', 'validity']) assert.equal(item[field], '');
  assert.match(item.warning, /divergentes/);
});

test('manifest inválido e shard ausente falham explicitamente sem recorrer ao cache complementar', t => {
  const { filePath, directory, metadata } = fixture(t);
  writeFileSync(filePath, JSON.stringify({ ...metadata, total: 999 }));
  const invalid = createSnapshotReader({ filePath, normalize: normalizeDatabase });
  assert.throws(() => invalid.get('365'), error => error.status === 503);
  writeFileSync(filePath, JSON.stringify(metadata));
  rmSync(join(directory, 'ca-000.json.gz'));
  const missing = createSnapshotReader({ filePath, normalize: normalizeDatabase });
  assert.throws(() => missing.get('365'), error => error.status === 503);
});
