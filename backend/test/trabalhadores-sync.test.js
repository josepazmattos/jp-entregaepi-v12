import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { createStore } from '../src/db/store.js';
import { createWorkerImportService, splitWorkerImport } from '../src/services/trabalhadores-import.service.js';
import { WORKER_COLUMNS, buildWorkerImport } from '../src/services/trabalhadores.service.js';

const company = 'synthetic-company-A';
const actor = 'synthetic-user-A';
function cpfFor(number) {
  let digits = String(number + 100000000).padStart(9, '0');
  for (const length of [9, 10]) {
    const sum = [...digits].reduce((total, char, i) => total + Number(char) * (length + 1 - i), 0);
    const digit = sum * 10 % 11;
    digits += String(digit === 10 ? 0 : digit);
  }
  return digits;
}
function worker(index, extra = {}) {
  return { nomeCompleto: `TRABALHADOR SINTÉTICO ${String(index).padStart(4, '0')}`, cpf: cpfFor(index), matriculaESocial: String(index).padStart(6, '0'), funcao: 'FUNÇÃO SINTÉTICA', localidade: 'CIDADE SINTÉTICA', ...extra };
}
async function upload(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Trabalhadores');
  sheet.addRow(WORKER_COLUMNS.map(column => column.label));
  rows.forEach(data => sheet.addRow(WORKER_COLUMNS.map(column => data[column.key] ?? '')));
  return { arquivoNome: 'trabalhadores-sinteticos.xlsx', arquivoBase64: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64'), empresaId: company, actor };
}
function selection(importacaoId, overrides = {}) { return { id: importacaoId, empresaId: company, actor, ...overrides }; }

test('500 trabalhadores são validados antes de gravar e sincronizados em lotes retomáveis sem duplicação', async () => {
  const store = createStore({ allowMemory: true });
  let loseResponse = false;
  const unreliableStore = { ...store, async transact(args) {
    const result = await store.transact(args);
    if (loseResponse && args.scope.startsWith('trabalhadores:')) { loseResponse = false; throw new Error('Simulated response loss after durable commit'); }
    return result;
  } };
  const importer = createWorkerImportService(unreliableStore);
  const rows = Array.from({ length: 500 }, (_, i) => worker(i + 1));
  let preview = await importer.preview(await upload(rows));
  assert.equal(preview.podeConfirmar, true);
  assert.equal(preview.resumo.total, 500);
  assert.equal(preview.lotesTotal, 7);
  assert.equal((await store.list('trabalhador', company)).length, 0);
  const args = selection(preview.importacaoId);
  const [first, concurrent] = await Promise.all([importer.confirm(args), importer.confirm(args)]);
  assert.equal(first.processados, 80);
  assert.equal(concurrent.processados, 80);
  assert.equal((await store.list('trabalhador', company)).length, 80);
  loseResponse = true;
  await assert.rejects(importer.confirm(args), /Simulated response loss/);
  preview = await importer.getProgress(args);
  assert.equal(preview.processados, 160);
  assert.equal(preview.status, 'em_andamento');
  while (preview.status !== 'concluida') preview = await importer.confirm(args);
  assert.equal(preview.processados, 500);
  assert.equal(preview.podeConfirmar, false);
  assert.equal((await store.list('trabalhador', company)).length, 500);
  assert.equal((await importer.confirm(args)).status, 'concluida');
  assert.equal((await store.list('trabalhador', company)).length, 500);
  const repeat = await importer.preview(await upload(rows));
  assert.equal(repeat.status, 'sem_alteracoes');
  assert.equal(repeat.resumo.inalterados, 500);
});

test('uma linha inválida impede toda gravação, mesmo nas linhas válidas do primeiro lote', async () => {
  const store = createStore({ allowMemory: true });
  const importer = createWorkerImportService(store);
  const rows = Array.from({ length: 85 }, (_, i) => worker(i + 1));
  rows[84].cpf = '00000000000';
  const preview = await importer.preview(await upload(rows));
  assert.equal(preview.status, 'invalida');
  assert.equal(preview.resumo.erros, 1);
  assert.equal(preview.linhas.at(-1).linha, 86);
  await assert.rejects(importer.confirm(selection(preview.importacaoId)), error => error.code === 'IMPORTACAO_BLOQUEADA');
  assert.equal((await store.list('trabalhador', company)).length, 0);
});

test('alteração concorrente entre lotes bloqueia o restante e nova prévia preserva aplicados e ausentes', async () => {
  const store = createStore({ allowMemory: true });
  const importer = createWorkerImportService(store);
  const rows = Array.from({ length: 85 }, (_, i) => worker(i + 1));
  const preview = await importer.preview(await upload(rows));
  const args = selection(preview.importacaoId);
  await importer.confirm(args);
  await importer.createWorker({ body: worker(900), empresaId: company, actor: 'another-synthetic-user' });
  await assert.rejects(importer.confirm(args), error => error.code === 'IMPORTACAO_DESATUALIZADA' && error.importacao.processados === 80 && error.importacao.status === 'conflito');
  assert.equal((await store.list('trabalhador', company)).length, 81);
  let resumed = await importer.preview(await upload(rows));
  assert.equal(resumed.resumo.inalterados, 80);
  assert.equal(resumed.resumo.criar, 5);
  const resumedArgs = selection(resumed.importacaoId);
  while (resumed.podeConfirmar) resumed = await importer.confirm(resumedArgs);
  assert.equal(resumed.status, 'concluida');
  assert.equal((await store.list('trabalhador', company)).length, 86);
});

test('escopo/autor/expiração são conferidos no servidor e não gravam dados fora da empresa', async () => {
  const store = createStore({ allowMemory: true });
  let now = new Date('2026-10-07T00:00:00Z');
  const importer = createWorkerImportService(store, { clock: () => now });
  const preview = await importer.preview(await upload([worker(1)]));
  const args = selection(preview.importacaoId);
  await assert.rejects(importer.getProgress({ ...args, empresaId: 'synthetic-company-B' }), error => error.status === 404);
  await assert.rejects(importer.confirm({ ...args, actor: 'another-actor' }), error => error.status === 404);
  now = new Date('2026-10-07T00:31:00Z');
  assert.equal((await importer.getProgress(args)).status, 'expirada');
  await assert.rejects(importer.confirm(args), error => error.code === 'IMPORTACAO_EXPIRADA');
  assert.equal((await store.list('trabalhador')).length, 0);
});

test('conflito de versão do trabalhador desfaz todo o lote, inclusive novos registros anteriores', async () => {
  const store = createStore({ allowMemory: true });
  const importer = createWorkerImportService(store);
  const original = await importer.createWorker({ body: worker(1), empresaId: company, actor });
  const preview = await importer.preview(await upload([worker(2), worker(1, { funcao: 'FUNÇÃO IMPORTADA' })]));
  await store.update('trabalhador', original.item.id, { funcao: 'ALTERAÇÃO MAIS RECENTE' });
  await assert.rejects(importer.confirm(selection(preview.importacaoId)), error => error.code === 'IMPORTACAO_DESATUALIZADA');
  const records = await store.list('trabalhador', company);
  assert.equal(records.length, 1);
  assert.equal(records[0].funcao, 'ALTERAÇÃO MAIS RECENTE');
});

test('cadastros simultâneos com a mesma identidade reutilizam um único trabalhador', async () => {
  const store = createStore({ allowMemory: true });
  const importer = createWorkerImportService(store);
  const args = { body: worker(1), empresaId: company, actor };
  const responses = await Promise.all([importer.createWorker(args), importer.createWorker(args)]);
  assert.equal(responses[0].item.id, responses[1].item.id);
  assert.equal((await store.list('trabalhador', company)).length, 1);
  await assert.rejects(importer.createWorker({ ...args, body: worker(1, { matriculaESocial: 'OUTRA' }) }), error => error.code === 'TRABALHADOR_IDENTIDADE_CONFLITO');
});

test('lotes com campos grandes respeitam o limite por item do banco', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ linha: i + 2, data: worker(i + 1, { nomeCompleto: 'N'.repeat(300), funcao: 'F'.repeat(300), localidade: 'L'.repeat(300), setor: 'S'.repeat(300), observacoes: 'O'.repeat(1000), email: `${'e'.repeat(240)}@example.test` }) }));
  const plan = buildWorkerImport({ rows, existing: [], empresaId: company, actor });
  const chunks = splitWorkerImport(plan);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.linhas.length, 0), 500);
  assert.ok(chunks.every(chunk => chunk.linhas.length <= 80 && Buffer.byteLength(JSON.stringify(chunk)) <= 240 * 1024));
});


test('contenção transitória 503 mantém a importação parcial retomável sem invalidar a prévia', async () => {
  const store = createStore({ allowMemory: true });
  let busy = false;
  const contendedStore = { ...store, async transact(args) {
    if (busy && args.scope.startsWith('trabalhadores:')) {
      busy = false;
      throw Object.assign(new Error('Outra operação está em andamento. Tente novamente.'), { status: 503, code: 'TRANSACAO_OCUPADA' });
    }
    return store.transact(args);
  } };
  const importer = createWorkerImportService(contendedStore);
  const preview = await importer.preview(await upload(Array.from({ length: 85 }, (_, i) => worker(i + 1))));
  const args = selection(preview.importacaoId);
  await importer.confirm(args);
  busy = true;
  await assert.rejects(importer.confirm(args), error => error.status === 503 && error.code === 'TRANSACAO_OCUPADA'
    && error.importacao.status === 'em_andamento' && error.importacao.podeConfirmar === true && error.importacao.processados === 80);
  const progress = await importer.getProgress(args);
  assert.equal(progress.status, 'em_andamento');
  assert.equal(progress.podeConfirmar, true);
  assert.equal(progress.processados, 80);
  assert.equal((await store.list('trabalhador', company)).length, 80);
  const completed = await importer.confirm(args);
  assert.equal(completed.status, 'concluida');
  assert.equal(completed.processados, 85);
  assert.equal((await store.list('trabalhador', company)).length, 85);
});


test('cadastro manual e importação do modelo real preservam matrícula alfanumérica longa e sincronizam pela identidade completa', async () => {
  const store = createStore({ allowMemory: true });
  const importer = createWorkerImportService(store);
  const matricula = '000AbC123'.repeat(80) + 'xYz9';
  const originalPerson = worker(700, { matriculaESocial: matricula });
  const manual = await importer.createWorker({ body: { ...originalPerson, matriculaESocial: `  ${matricula}  ` }, empresaId: company, actor });
  assert.equal(manual.item.matriculaESocial, matricula);
  assert.ok(manual.item.matriculaESocial.length > 600);
  const repeated = await importer.createWorker({ body: originalPerson, empresaId: company, actor });
  assert.equal(repeated.item.id, manual.item.id);
  assert.equal(repeated.reutilizado, true);

  const templateUrl = new URL('../../frontend/EntregaEPI/assets/modelo-trabalhadores.xlsx', import.meta.url);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(templateUrl));
  const sheet = workbook.getWorksheet('Trabalhadores');
  const secondMatricula = matricula + 'FimB007';
  const rows = [{ ...originalPerson, matriculaESocial: ` ${matricula} `, funcao: 'FUNÇÃO ATUALIZADA' }, worker(701, { matriculaESocial: secondMatricula })];
  rows.forEach((person, index) => WORKER_COLUMNS.forEach((column, columnIndex) => { sheet.getCell(index + 2, columnIndex + 1).value = person[column.key] ?? ''; }));
  const file = { arquivoNome: 'matriculas-longas-sinteticas.xlsx', arquivoBase64: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64'), empresaId: company, actor };
  const preview = await importer.preview(file);
  assert.equal(preview.resumo.erros, 0);
  assert.equal(preview.resumo.atualizar, 1);
  assert.equal(preview.resumo.criar, 1);
  assert.deepEqual(preview.linhas.map(row => row.matriculaESocial), [matricula, secondMatricula]);
  const completed = await importer.confirm(selection(preview.importacaoId));
  assert.equal(completed.status, 'concluida');
  const records = await store.list('trabalhador', company);
  assert.equal(records.length, 2);
  assert.equal(records.find(person => person.id === manual.item.id).matriculaESocial, matricula);
  assert.equal(records.find(person => person.id === manual.item.id).funcao, 'FUNÇÃO ATUALIZADA');
  assert.equal(records.find(person => person.cpf === rows[1].cpf).matriculaESocial, secondMatricula);
  const synchronized = await importer.preview(file);
  assert.equal(synchronized.status, 'sem_alteracoes');
  assert.equal(synchronized.resumo.inalterados, 2);
});
