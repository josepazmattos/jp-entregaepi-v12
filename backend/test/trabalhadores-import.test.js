import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerImport, validateWorker, validCPF, sortWorkers, publicImport, WORKER_IMPORT_LIMIT, WORKER_COLUMNS } from '../src/services/trabalhadores.service.js';

function worker(overrides = {}) {
  return { nomeCompleto: 'TRABALHADOR SINTÉTICO', cpf: '52998224725', matriculaESocial: '00001', funcao: 'FUNÇÃO SINTÉTICA', localidade: 'CIDADE SINTÉTICA', ...overrides };
}
function plan(rows, existing = [], extra = {}) {
  return buildWorkerImport({ rows: rows.map((data, i) => ({ linha: i + 2, data })), existing, empresaId: 'synthetic-A', actor: 'synthetic-user', ...extra });
}
function stored(overrides = {}) {
  return { ...worker(), nome: 'TRABALHADOR SINTÉTICO', id: 'existing-worker', empresaId: 'synthetic-A', _version: 3, updatedAt: '2026-01-01T00:00:00.000Z', status: 'Ativo', ...overrides };
}

test('validação normaliza CPF, preserva matrícula com zeros e confere datas/status', () => {
  assert.equal(validCPF('529.982.247-25'), true);
  assert.equal(validCPF('000.000.000-00'), false);
  assert.equal(validCPF('52998224724'), false);
  const valid = validateWorker(worker({ cpf: '529.982.247-25', dataAdmissao: '07/10/2026', status: 'inativo', telefone: '+55 67 99999-0000' }));
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.data.cpf, '52998224725');
  assert.equal(valid.data.matriculaESocial, '00001');
  assert.equal(valid.data.dataAdmissao, '2026-10-07');
  assert.equal(valid.data.status, 'Inativo');
  assert.match(validateWorker(worker({ dataAdmissao: '31/02/2026' })).errors.join(' '), /data válida/);
  assert.match(validateWorker(worker({ status: 'Demitido' })).errors.join(' '), /Ativo ou Inativo/);
  assert.match(validateWorker(worker({ nomeCompleto: { formula: 'SUM(A1)' } })).errors.join(' '), /texto simples/);
});

test('prévia faz upsert com dois identificadores, mantém ausentes e campos opcionais vazios', () => {
  const current = stored({ setor: 'Setor anterior', observacoes: 'Preservar', dataAdmissao: '2020-01-01' });
  const absent = stored({ id: 'absent', cpf: '11144477735', matriculaESocial: '00002', nomeCompleto: 'NÃO ENVIADO' });
  const result = plan([worker({ nomeCompleto: 'NOME ATUALIZADO', observacoes: '', setor: '' })], [current, absent]);
  assert.equal(result.podeConfirmar, true);
  assert.equal(result.resumo.atualizar, 1);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].id, current.id);
  assert.equal(result.writes[0].expectedVersion, 3);
  assert.equal(result.writes[0].data.nomeCompleto, 'NOME ATUALIZADO');
  assert.equal('observacoes' in result.writes[0].data, false);
  assert.equal('setor' in result.writes[0].data, false);
  assert.equal('dataAdmissao' in result.writes[0].data, false);
  assert.equal(result.writes.some(write => write.type === 'delete'), false);
});

test('importação inalterada não escreve e relatório público não revela plano interno/ator', () => {
  const result = plan([worker()], [stored()]);
  assert.equal(result.status, 'sem_alteracoes');
  assert.equal(result.resumo.inalterados, 1);
  assert.equal(result.podeConfirmar, false);
  assert.deepEqual(result.writes, []);
  const visible = publicImport({ ...result, id: 'preview-id', arquivoNome: 'sintetico.xlsx' });
  assert.equal(visible.importacaoId, 'preview-id');
  for (const key of ['writes', 'autorSub', 'empresaId']) assert.equal(key in visible, false);
});

test('divergência entre CPF e matrícula bloqueia todo lote, inclusive linhas válidas', () => {
  const result = plan([worker({ matriculaESocial: 'OUTRA' }), worker({ cpf: '11144477735', matriculaESocial: 'NOVO' })], [stored()]);
  assert.equal(result.resumo.erros, 1);
  assert.equal(result.resumo.criar, 1);
  assert.equal(result.podeConfirmar, false);
  assert.deepEqual(result.writes, []);
  assert.match(result.linhas[0].erros.join(' '), /não correspondem/);
  assert.equal(result.linhas[0].linha, 2);
});

test('duplicidades internas ou legadas bloqueiam todas as linhas envolvidas', () => {
  const duplicate = plan([worker(), worker({ nomeCompleto: 'OUTRO NOME' })]);
  assert.equal(duplicate.resumo.erros, 2);
  assert.deepEqual(duplicate.writes, []);
  assert.match(duplicate.linhas[0].erros.join(' '), /CPF repetido/);
  const legacy = plan([worker()], [stored(), stored({ id: 'duplicate' })]);
  assert.equal(legacy.podeConfirmar, false);
  assert.match(legacy.linhas[0].erros.join(' '), /mais de um cadastro/);
});

test('mesmo CPF de empresa diferente não é utilizado e escopo misturado é recusado', () => {
  const fresh = plan([worker()]);
  assert.equal(fresh.resumo.criar, 1);
  assert.equal(fresh.writes[0].data.empresaId, 'synthetic-A');
  assert.throws(() => plan([worker()], [stored({ empresaId: 'synthetic-B' })]), error => error.status === 403);
});

test('prévia expira, rejeita arquivo vazio/excessivo e ordena nomes alfabeticamente em português', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  assert.equal(plan([worker()], [], { now }).expiresAt, '2026-10-07T00:30:00.000Z');
  assert.throws(() => plan([]), error => error.code === 'IMPORTACAO_VAZIA');
  assert.throws(() => plan(Array.from({ length: WORKER_IMPORT_LIMIT + 1 }, () => worker())), error => error.code === 'IMPORTACAO_LIMITE');
  const names = ['Zélia', 'Érica', 'Ana', 'Álvaro'];
  assert.deepEqual(sortWorkers(names.map((nomeCompleto, id) => ({ id, nomeCompleto }))).map(item => item.nomeCompleto), ['Álvaro', 'Ana', 'Érica', 'Zélia']);
});


test('matrícula eSocial não tem limite de campo nem restrição numérica e preserva o texto recebido', () => {
  const matricula = '000AbC123'.repeat(80) + 'xYz9';
  assert.ok(matricula.length > 600);
  assert.equal(WORKER_COLUMNS.find(column => column.key === 'matriculaESocial').max, undefined);
  const checked = validateWorker(worker({ matriculaESocial: `  ${matricula}  ` }));
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.data.matriculaESocial, matricula);
  const opaque = '000A' + 'e\u0301' + 'bC9';
  assert.equal(validateWorker(worker({ matriculaESocial: opaque })).data.matriculaESocial, opaque);
  const longer = matricula.repeat(4);
  assert.deepEqual(validateWorker(worker({ matriculaESocial: longer })).errors, []);
  assert.equal(validateWorker(worker({ matriculaESocial: longer })).data.matriculaESocial, longer);
});
