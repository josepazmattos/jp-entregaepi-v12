import test from 'node:test';
import assert from 'node:assert/strict';
import fixtures from '../../tests/helpers/cadastro-fixtures.cjs';
import { readSocXlsx } from '../src/services/trabalhadores-soc.service.js';
import { decodeXlsx } from '../src/services/trabalhadores-xlsx.service.js';
import { createWorkerImportService } from '../src/services/trabalhadores-import.service.js';
import { createStore } from '../src/db/store.js';
const { socFile, CNPJ } = fixtures;
const read = (bytes, options = {}) => readSocXlsx(bytes, { companyCnpj: CNPJ, ...options });

test('SOC reconhece cabeçalho na segunda linha e 118 colunas, extrai apenas campos usados', async () => {
  const bytes = await socFile(), [row] = await read(bytes);
  assert.deepEqual(row.erros, []); assert.equal(row.linha, 3);
  assert.equal(row.data.matriculaESocial, '00001A'); assert.equal(row.data.funcao, 'TÉCNICO');
  assert.equal(row.data.localidade, 'CIDADE EXEMPLO/MS'); assert.equal(row.data.status, 'Ativo');
  assert.doesNotMatch(JSON.stringify(row), /NAO_ARMAZENAR/);
  assert.equal((await read(bytes, { matriculaColumn: 'matriculaRH' }))[0].data.matriculaESocial, 'RH-0001');
  assert.throws(() => decodeXlsx(bytes.toString('base64'), 'soc.xlsx'), /colunas extras/);
});
test('SOC lê colunas reordenadas e não avalia fórmulas de campos ignorados', async () => {
  const [row] = await read(await socFile({ change(sheet) {
    for (const n of [2, 3]) { const a = sheet.getRow(n).getCell(1).value; sheet.getRow(n).getCell(1).value = sheet.getRow(n).getCell(2).value; sheet.getRow(n).getCell(2).value = a; }
    sheet.getCell('P3').value = { formula: '1+1', result: 2 };
  } }));
  assert.deepEqual(row.erros, []); assert.equal(row.data.cpf, '52998224725');
});
test('SOC bloqueia CNPJ divergente, status desconhecido e campos obrigatórios ausentes', async () => {
  const [row] = await read(await socFile({ change(sheet) { sheet.getCell('J3').value = '11444777000161'; sheet.getCell('K3').value = 'P'; sheet.getCell('H3').value = ''; } }));
  assert.match(row.erros.join(' '), /CNPJ.*diferente/); assert.match(row.erros.join(' '), /Situação SOC/); assert.match(row.erros.join(' '), /Cidade Unidade/);
  await assert.rejects(read(await socFile(), { companyCnpj: '' }), /CNPJ válido/);
  await assert.rejects(read(await socFile(), { matriculaColumn: 'inventado' }), /Escolha/);
});
test('SOC recusa matrícula numérica, fórmulas em campo importado e cabeçalho duplicado', async () => {
  const [row] = await read(await socFile({ change(sheet) { sheet.getCell('C3').value = 1; sheet.getCell('E3').value = { formula: '1+1', result: 2 }; } }));
  assert.match(row.erros.join(' '), /zeros à esquerda/); assert.match(row.erros.join(' '), /fórmulas/);
  await assert.rejects(read(await socFile({ change(sheet) { sheet.getCell('R2').value = 'CPF'; } })), /Cabeçalho repetido/);
});
test('SOC em memória não grava o arquivo nem dados extras; confirma sem duplicar e preserva biometria', async () => {
  const store = createStore({ allowMemory: true }), company = await store.create('empresa', { nome: 'EMPRESA SINTÉTICA', cnpj: CNPJ });
  const calls = [], importer = createWorkerImportService({ ...store, async transact(args) { calls.push(args); return store.transact(args); } });
  const body = { arquivoNome: 'soc.xlsx', arquivoBase64: (await socFile()).toString('base64'), empresaId: company.id, actor: 'master-sintetico', origem: 'soc', master: true };
  const preview = await importer.preview(body), selection = { id: preview.importacaoId, empresaId: company.id, actor: body.actor, master: true };
  assert.equal(preview.podeConfirmar, true); assert.equal(preview.linhas[0].dados.funcao, 'TÉCNICO');
  assert.equal((await store.list('trabalhador', company.id)).length, 0);
  await assert.rejects(importer.confirm({ ...selection, master: false }), error => error.status === 403);
  await assert.rejects(importer.getProgress({ ...selection, master: false }), error => error.status === 403);
  await assert.rejects(importer.preview({ ...body, master: false }), error => error.status === 403);
  await importer.confirm(selection); await importer.confirm(selection);
  let [worker] = await store.list('trabalhador', company.id);
  await store.update('trabalhador', worker.id, { biometrias: { '1': { synthetic: true } }, observacoes: 'MANTER' });
  const changed = await importer.preview({ ...body, arquivoBase64: (await socFile({ change(sheet) { sheet.getCell('E3').value = 'NOVA FUNÇÃO'; } })).toString('base64') });
  await importer.confirm({ ...selection, id: changed.importacaoId });
  [worker] = await store.list('trabalhador', company.id);
  assert.equal(worker.funcao, 'NOVA FUNÇÃO'); assert.deepEqual(worker.biometrias, { '1': { synthetic: true } }); assert.equal(worker.observacoes, 'MANTER');
  assert.equal((await store.list('trabalhador', company.id)).length, 1);
  assert.doesNotMatch(JSON.stringify(calls), /NAO_ARMAZENAR|arquivoBase64|UEsDB/);
  const again = await importer.preview(body);
  await store.update('empresa', company.id, { cnpj: '11444777000161' });
  await assert.rejects(importer.confirm({ ...selection, id: again.importacaoId }), error => error.code === 'IMPORTACAO_DESATUALIZADA');
});
test('SOC duplicado não permite confirmação e N corresponde a Inativo', async () => {
  const bytes = await socFile({ rows: 2, change(sheet) { sheet.getCell('B4').value = sheet.getCell('B3').value; sheet.getCell('K3').value = 'N'; } });
  assert.equal((await read(bytes))[0].data.status, 'Inativo');
  const store = createStore({ allowMemory: true }), company = await store.create('empresa', { cnpj: CNPJ });
  const preview = await createWorkerImportService(store).preview({ arquivoNome: 'soc.xlsx', arquivoBase64: bytes.toString('base64'), empresaId: company.id, actor: 'master', origem: 'soc', master: true });
  assert.equal(preview.podeConfirmar, false); assert.equal(preview.resumo.erros, 2);
});
