// Synthetic SOC benchmark; optional first argument is a baseline repository's backend directory.
// No AWS calls or customer records. Local timings do not predict production network latency.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { socFile, CNPJ } = require('./helpers/cadastro-fixtures.cjs');
function cpfFor(number) {
  let value = String(100000000 + number);
  for (const length of [9, 10]) { const digit = [...value].reduce((sum, n, i) => sum + Number(n) * (length + 1 - i), 0) * 10 % 11; value += digit === 10 ? '0' : String(digit); }
  return value;
}
async function run(backend, file, compact, size) {
  const { createStore } = await import(pathToFileURL(path.join(backend, 'src/db/store.js')));
  const { createWorkerImportService } = await import(pathToFileURL(path.join(backend, 'src/services/trabalhadores-import.service.js')));
  const store = createStore({ allowMemory: true });
  const company = await store.create('empresa', { nome: 'EMPRESA SINTÉTICA', cnpj: CNPJ });
  let chunkReads = 0;
  const importer = createWorkerImportService({ ...store, async get(entity, id) { if (entity === 'trabalhador_importacao_lote') chunkReads++; return store.get(entity, id); } });
  const start = performance.now();
  let report = await importer.preview({ arquivoNome: 'SOC-sintetico.xlsx', arquivoBase64: file.toString('base64'), empresaId: company.id, actor: 'benchmark', master: true, origem: 'soc' });
  assert.equal(report.resumo.erros, 0);
  const previewMs = performance.now() - start;
  let confirmationBytes = 0, batches = 0;
  const syncStart = performance.now();
  while (report.podeConfirmar) {
    report = await importer.confirm({ id: report.importacaoId, empresaId: company.id, actor: 'benchmark', master: true, compact });
    confirmationBytes += Buffer.byteLength(JSON.stringify(report)); batches++;
  }
  const syncMs = performance.now() - syncStart;
  assert.equal(report.status, 'concluida'); assert.equal(report.processados, size);
  assert.equal((await store.list('trabalhador', company.id)).length, size);
  return { previewMs, syncMs, confirmationBytes, chunkReads, batches };
}
(async () => {
  const candidates = [...(process.argv[2] ? [{ label: 'before', backend: path.resolve(process.argv[2]), compact: false }] : []), { label: 'after', backend: path.resolve(__dirname, '../backend'), compact: true }];
  const results = [];
  for (const size of [102, 500]) {
    const file = await socFile({ rows: size, change(sheet) {
      for (let row = 3; row < size + 3; row++) {
        sheet.getCell(row, 2).value = cpfFor(row); sheet.getCell(row, 3).value = String(row).padStart(6, '0');
        for (let col = 18; col <= 118; col++) sheet.getCell(row, col).value = `DADO IGNORADO SINTETICO ${row}-${col}`;
      }
    } });
    for (const candidate of candidates) await run(candidate.backend, file, candidate.compact, size); // warmup
    const samples = new Map(candidates.map(candidate => [candidate.label, []]));
    for (let i = 0; i < 3; i++) for (const candidate of i % 2 ? [...candidates].reverse() : candidates) samples.get(candidate.label).push(await run(candidate.backend, file, candidate.compact, size));
    for (const candidate of candidates) {
      const measures = samples.get(candidate.label), mean = field => Math.round(measures.reduce((sum, item) => sum + item[field], 0) / measures.length * 10) / 10;
      results.push({ workers: size, columns: 118, fileBytes: file.length, version: candidate.label, samples: measures.length, previewMs: mean('previewMs'), syncMs: mean('syncMs'), confirmationBytes: mean('confirmationBytes'), chunkReads: mean('chunkReads'), batches: mean('batches') });
    }
  }
  console.log(JSON.stringify({ synthetic: true, storage: 'memory', productionLatencyMeasured: false, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
