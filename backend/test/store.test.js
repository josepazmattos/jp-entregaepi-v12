import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createStore } from '../src/db/store.js';

function stubClient(send) {
  const low = new DynamoDBClient({ region: 'sa-east-1', endpoint: 'http://127.0.0.1:9', credentials: { accessKeyId: 'synthetic-test', secretAccessKey: 'synthetic-test' } });
  const client = DynamoDBDocumentClient.from(low, { marshallOptions: { removeUndefinedValues: true } });
  client.send = send;
  return client;
}

test('ausência de TABLE_NAME não confirma gravação volátil', async () => {
  const store = createStore();
  assert.equal(store.status().configured, false);
  assert.equal((await store.probe()).ready, false);
  await assert.rejects(store.create('empresa', { nome: 'SINTÉTICA' }), error => error.status === 503);
  const brokenClient = createStore({ tableName: 'test-only', allowMemory: true });
  await assert.rejects(brokenClient.list('empresa'), error => error.status === 503);
});

test('paginação DynamoDB atravessa página filtrada vazia e preserva filtro por empresa', async () => {
  const requests = [];
  const pages = [
    { Items: [], LastEvaluatedKey: { pk: 'unused#1', sk: 'META' } },
    { Items: [{ id: 'record-one', updatedAt: '2026-01-01' }], LastEvaluatedKey: { pk: 'unused#2', sk: 'META' } },
    { Items: [{ id: 'record-two', updatedAt: '2026-02-01' }] }
  ];
  const client = stubClient(async command => { requests.push(structuredClone(command.input)); return pages[requests.length - 1]; });
  const store = createStore({ tableName: 'synthetic-table', client });
  assert.deepEqual((await store.list('trabalhador', 'synthetic-company')).map(item => item.id), ['record-two', 'record-one']);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1].ExclusiveStartKey, pages[0].LastEvaluatedKey);
  assert.ok(requests.every(request => request.ExpressionAttributeValues[':empresaId'] === 'synthetic-company'));
});

test('criação não permite sobrescrever IDs e alteração antiga não apaga versão mais recente', async () => {
  const store = createStore({ allowMemory: true });
  const first = await store.create('ficha', { id: 'provided-id', empresaId: 'A', createdAt: 'falsified', status: 'pendente' });
  assert.notEqual(first.id, 'provided-id');
  assert.notEqual(first.createdAt, 'falsified');
  const second = await store.create('ficha', { id: first.id, empresaId: 'A' });
  assert.notEqual(second.id, first.id);
  const updated = await store.update('ficha', first.id, { status: 'cancelada' }, { expectedVersion: first._version });
  await assert.rejects(store.remove('ficha', first.id, { expectedVersion: first._version }), error => error.code === 'REGISTRO_ALTERADO');
  assert.equal((await store.get('ficha', first.id)).status, 'cancelada');
  assert.equal(updated.createdAt, first.createdAt);
  await assert.rejects(store.update('ficha', first.id, { empresaId: 'B' }), error => error.status === 403);
});

test('conflito condicional DynamoDB volta como 409 e não vira gravação em memória', async () => {
  const previous = { id: 'synthetic', pk: 'ficha#synthetic', sk: 'META', entity: 'ficha', empresaId: 'A', _version: 4, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  let condition;
  const client = stubClient(async command => {
    if (command.constructor.name === 'GetCommand') return { Item: previous };
    condition = command.input;
    throw Object.assign(new Error('conditional test'), { name: 'ConditionalCheckFailedException' });
  });
  const store = createStore({ tableName: 'synthetic-table', client });
  await assert.rejects(store.update('ficha', 'synthetic', { status: 'cancelada' }), error => error.status === 409);
  assert.match(condition.ConditionExpression, /#version = :version/);
  assert.equal(condition.ExpressionAttributeValues[':version'], 4);
});

test('readiness usa chave técnica, não enumera dados e relata acesso negado', async () => {
  const requests = [];
  const client = stubClient(async command => { requests.push(command.input); throw new Error('synthetic denied'); });
  const store = createStore({ tableName: 'synthetic-table', client });
  const result = await store.probe();
  assert.equal(result.ready, false);
  assert.deepEqual(requests[0].Key, { pk: '__health__#readiness', sk: 'META' });
});
