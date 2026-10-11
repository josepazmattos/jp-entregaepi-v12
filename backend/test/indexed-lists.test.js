import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexedLists } from '../src/db/indexed-lists.js';
import { recentListIds } from '../src/routes/_helpers.js';

const row = (id, company = 'A') => ({ pk: `trabalhador#${id}`, sk: 'META', entity: 'trabalhador', id, empresaId: company, updatedAt: `2026-10-${id}` });
function reader(send) { return createIndexedLists({ client: { send }, tableName: 'synthetic', entityIndex: 'entity-pk', companyIndex: 'company-pk', delay: async () => {} }); }

test('consulta somente empresa e tipo, atravessa páginas e lê registros atuais sem Scan', async () => {
  const commands = []; let page = 0;
  const list = reader(async command => {
    commands.push(command);
    if (command.constructor.name === 'QueryCommand') return page++ === 0
      ? { Items: [row('01')], LastEvaluatedKey: { pk: 'trabalhador#01', sk: 'META', empresaId: 'A' } }
      : { Items: [row('02'), row('03')] };
    return { Responses: { synthetic: [row('02'), row('01'), row('03', 'B')] } };
  });
  assert.deepEqual((await list('trabalhador', 'A')).map(x => x.id), ['02', '01']);
  assert.equal(commands.length, 3);
  for (const command of commands.slice(0, 2)) {
    assert.equal(command.input.IndexName, 'company-pk');
    assert.equal(command.input.ExpressionAttributeValues[':company'], 'A');
    assert.equal(command.input.ExpressionAttributeValues[':prefix'], 'trabalhador#');
    assert.equal(command.input.FilterExpression, undefined);
  }
  assert.ok(commands[1].input.ExclusiveStartKey);
  assert.equal(commands[2].input.RequestItems.synthetic.ConsistentRead, true);
});

test('catálogo e empresas consultam partição por entidade, sem varrer trabalhadores/biometrias', async () => {
  const list = reader(async command => {
    assert.equal(command.constructor.name, 'QueryCommand');
    assert.equal(command.input.IndexName, 'entity-pk');
    assert.deepEqual(command.input.ExpressionAttributeValues, { ':entity': 'epi' });
    return { Items: [] };
  });
  assert.deepEqual(await list('epi'), []);
});

test('novo registro aparece durante propagação do índice; registro de outra empresa e excluído não aparecem', async () => {
  const list = reader(async command => command.constructor.name === 'QueryCommand'
    ? { Items: [row('removed')] }
    : { Responses: { synthetic: [row('new'), row('foreign', 'B')] } });
  assert.deepEqual((await list('trabalhador', 'A', ['new', 'foreign'])).map(x => x.id), ['new']);
});

test('consulta com mais de 100 registros mantém todos, em lotes; repetição não duplica chaves', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => row(String(i).padStart(3, '0')));
  let batches = 0;
  const list = reader(async command => {
    if (command.constructor.name === 'QueryCommand') return { Items: [...rows, rows[0]] };
    batches++;
    assert.ok(command.input.RequestItems.synthetic.Keys.length <= 100);
    return { Responses: { synthetic: command.input.RequestItems.synthetic.Keys.map(k => rows.find(r => r.pk === k.pk)) } };
  });
  assert.equal((await list('trabalhador', 'A', ['000'])).length, 205);
  assert.equal(batches, 3);
});

test('throttling repete só as chaves pendentes e falha explicitamente se não conseguir completar', async () => {
  let count = 0;
  const list = reader(async command => {
    if (command.constructor.name === 'QueryCommand') return { Items: [row('01'), row('02')] };
    if (!count++) return { Responses: { synthetic: [row('01')] }, UnprocessedKeys: { synthetic: { Keys: [{ pk: 'trabalhador#02', sk: 'META' }], ConsistentRead: true } } };
    assert.equal(command.input.RequestItems.synthetic.Keys.length, 1);
    return { Responses: { synthetic: [row('02')] } };
  });
  assert.equal((await list('trabalhador', 'A')).length, 2);
  const busy = reader(async command => command.constructor.name === 'QueryCommand'
    ? { Items: [row('01')] } : { UnprocessedKeys: command.input.RequestItems });
  await assert.rejects(busy('trabalhador', 'A'), error => error.code === 'CONSULTA_OCUPADA');
});

test('falha no índice não faz Scan silencioso e parâmetros extensos são recusados', async () => {
  const list = reader(async () => { throw new Error('synthetic-index-unavailable'); });
  await assert.rejects(list('epi'), /synthetic-index-unavailable/);
  await assert.rejects(list('biometria'), /Unsupported/);
  assert.throws(() => recentListIds({ query: { recentIds: ['A'] } }), e => e.status === 400);
  assert.throws(() => recentListIds({ query: { recentIds: Array.from({ length: 101 }, (_, i) => String(i)).join(',') } }), e => e.status === 400);
});
