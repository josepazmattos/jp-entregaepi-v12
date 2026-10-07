import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createStore } from '../src/db/store.js';

const createOperation = (id, name = id) => ({ type: 'create', entity: 'trabalhador', id, data: { empresaId: 'empresa-a', nomeCompleto: name } });
const registration = { nome: 'EMPRESA SINTÉTICA', cnpj: '11222333000181', login: 'empresa-sintetica', acessoStatus: 'pendente' };

test('lote atômico grava todos, rejeita conflito sem alteração parcial e repete sem duplicar', async () => {
  const store = createStore({ allowMemory: true });
  const input = { scope: 'trabalhadores:empresa-a', expectedRevision: 0, mutationId: 'arquivo-1-lote-0', operations: [createOperation('ana'), createOperation('bia')], result: { processados: 2 } };
  assert.deepEqual(await store.transact(input), { revision: 1, result: { processados: 2 }, replayed: false });
  assert.deepEqual(await store.transact(input), { revision: 1, result: { processados: 2 }, replayed: true });
  assert.equal((await store.list('trabalhador', 'empresa-a')).length, 2);
  await assert.rejects(store.transact({ ...input, result: { processados: 500 } }), error => error.code === 'IDEMPOTENCIA_DIVERGENTE');
  await assert.rejects(store.transact({ ...input, expectedRevision: 1, mutationId: 'arquivo-2', operations: [createOperation('caio'), createOperation('ana', 'ALTERADA')] }), error => error.code === 'REGISTRO_ALTERADO');
  assert.equal(await store.get('trabalhador', 'caio'), null);
  assert.equal((await store.get('trabalhador', 'ana')).nomeCompleto, 'ana');
  assert.equal(await store.readScope(input.scope), 1);
});

test('duas confirmações concorrentes da mesma operação têm um único efeito', async () => {
  const store = createStore({ allowMemory: true });
  const input = { scope: 'workers-a', expectedRevision: 0, mutationId: 'shared', operations: [createOperation('one')], result: { count: 1 } };
  const results = await Promise.all([store.transact(input), store.transact(input)]);
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.equal(await store.readScope('workers-a'), 1);
  assert.equal((await store.list('trabalhador')).length, 1);
});

test('versão e vínculo protegem atualizações contra outro navegador e outra empresa', async () => {
  const store = createStore({ allowMemory: true });
  const first = await store.create('trabalhador', { empresaId: 'empresa-a', nomeCompleto: 'ANA' });
  const updated = await store.update('trabalhador', first.id, { nomeCompleto: 'ANA ATUALIZADA' });
  const base = { scope: 'workers-a', expectedRevision: 0, mutationId: 'update-1', operations: [{ type: 'update', entity: 'trabalhador', id: first.id, data: { nomeCompleto: 'ANTIGA' }, expectedVersion: first._version }], result: null };
  await assert.rejects(store.transact(base), error => error.code === 'REGISTRO_ALTERADO');
  await assert.rejects(store.transact({ ...base, operations: [{ ...base.operations[0], expectedVersion: updated._version, data: { empresaId: 'empresa-b' } }] }), error => error.code === 'EMPRESA_DIVERGENTE');
  assert.equal((await store.get('trabalhador', first.id)).nomeCompleto, 'ANA ATUALIZADA');
  assert.equal(await store.readScope('workers-a'), 0);
});

test('reserva de empresa impede CNPJ/login duplicados e reconhece reenvio após timeout', async () => {
  const store = createStore({ allowMemory: true });
  const results = await Promise.allSettled([
    store.reserveCompanyRegistration(registration, { requestId: 'request-a', actorSub: 'master' }),
    store.reserveCompanyRegistration({ ...registration, cnpj: '11.222.333/0001-81' }, { requestId: 'request-b', actorSub: 'master' })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.list('empresa')).length, 1);
  const first = results.find(result => result.status === 'fulfilled').value.item;
  const requestId = first._accessRegistration.requestId;
  const resumed = await store.reserveCompanyRegistration(registration, { requestId, actorSub: 'master' });
  assert.equal(resumed.item.id, first.id);
  assert.equal(resumed.created, false);
  assert.equal((await store.getCompanyRegistration(requestId, 'master')).id, first.id);
  assert.equal(await store.getCompanyRegistration(requestId, 'different-master'), null);
  await assert.rejects(store.reserveCompanyRegistration({ ...registration, login: 'other-login' }, { requestId, actorSub: 'master' }), error => error.code === 'IDEMPOTENCIA_DIVERGENTE');
});

test('provisionar empresa legada preserva IDs, trabalhadores e fichas', async () => {
  const store = createStore({ allowMemory: true });
  const empresa = await store.create('empresa', { nome: 'LEGADA', cnpj: registration.cnpj });
  const trabalhador = await store.create('trabalhador', { nomeCompleto: 'PESSOA TESTE', empresaId: empresa.id });
  const ficha = await store.create('ficha', { empresaId: empresa.id, trabalhadorId: trabalhador.id });
  const result = await store.reserveCompanyRegistration({ ...registration, nome: 'LEGADA' }, { requestId: 'legacy', actorSub: 'master', empresaId: empresa.id, expectedVersion: empresa._version });
  assert.equal(result.item.id, empresa.id);
  assert.equal(result.created, false);
  assert.equal((await store.get('trabalhador', trabalhador.id)).empresaId, empresa.id);
  assert.equal((await store.get('ficha', ficha.id)).trabalhadorId, trabalhador.id);
  assert.equal((await store.list('empresa')).length, 1);
});

test('DynamoDB usa uma transação condicional para registros, escopo e recibo', async () => {
  const low = new DynamoDBClient({ region: 'sa-east-1', endpoint: 'http://127.0.0.1:9', credentials: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic' } });
  const client = DynamoDBDocumentClient.from(low);
  const sent = [];
  client.send = async command => { sent.push(command); return {}; };
  const store = createStore({ tableName: 'synthetic-only', client });
  await store.transact({ scope: 'scope', expectedRevision: 0, mutationId: 'one', operations: [createOperation('one')], result: { count: 1 } });
  const transaction = sent.find(command => command.constructor.name === 'TransactWriteCommand');
  assert.equal(transaction.input.TransactItems.length, 3);
  assert.ok(transaction.input.TransactItems.every(item => item.Put.ConditionExpression === 'attribute_not_exists(#pk)'));
  assert.equal(sent.filter(command => command.constructor.name !== 'GetCommand').length, 1);
});

test('contenção transitória do DynamoDB preserva a operação para retomada', async () => {
  for (const failure of [
    { name: 'TransactionConflictException' },
    { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'None' }, { Code: 'TransactionConflict' }] }
  ]) {
    let transactions = 0;
    const client = { send: async command => {
      if (command.constructor.name === 'TransactWriteCommand' && ++transactions === 1) throw Object.assign(new Error('synthetic contention'), failure);
      return {};
    } };
    const store = createStore({ tableName: 'synthetic-only', client });
    const request = { scope: 'workers-a', expectedRevision: 0, mutationId: 'retry-batch', operations: [createOperation('one')], result: { count: 1 } };
    await assert.rejects(store.transact(request), error => error.code === 'TRANSACAO_OCUPADA' && error.status === 503);
    assert.equal((await store.transact(request)).revision, 1);
    assert.equal(transactions, 2);
  }
});

test('condição desatualizada continua sendo conflito e falhas distintas não são ocultadas', async () => {
  const validation = Object.assign(new Error('synthetic invalid transaction'), { name: 'ValidationException' });
  for (const failure of [
    Object.assign(new Error('synthetic stale condition'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] }),
    validation
  ]) {
    const client = { send: async command => { if (command.constructor.name === 'TransactWriteCommand') throw failure; return {}; } };
    const store = createStore({ tableName: 'synthetic-only', client });
    await assert.rejects(store.transact({ scope: 'workers-a', expectedRevision: 0, mutationId: 'one', operations: [createOperation('one')] }),
      error => failure === validation ? error === validation : error.code === 'REGISTRO_ALTERADO' && error.status === 409);
  }
});
