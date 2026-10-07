import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// An isolated conditional-write double exercises the actual Lambda routes and
// DynamoDB optimistic-lock adapter. No AWS request or real biometric data is used.
const records = new Map();
let successfulSignWrites = 0, simultaneousWrite = null;
mock.method(DynamoDBDocumentClient.prototype, 'send', async function (command) {
  const input = command.input;
  const key = (input.Key || input.Item)?.pk;
  if (command.constructor.name === 'GetCommand') return { Item: structuredClone(records.get(key)) };
  if (command.constructor.name !== 'PutCommand') throw new Error(`Unexpected AWS operation in synthetic test: ${command.constructor.name}`);
  if (simultaneousWrite?.key === key && input.Item.status === 'assinada') {
    const gate = simultaneousWrite;
    gate.arrived += 1;
    if (gate.arrived === 2) gate.release();
    await gate.ready;
  }
  const previous = records.get(key), condition = input.ConditionExpression || '';
  const conflict = condition.includes('attribute_not_exists(#pk)') ? Boolean(previous)
    : condition.includes('attribute_exists(#pk)') && (!previous
      || condition.includes('#version = :version') && previous._version !== input.ExpressionAttributeValues[':version']
      || condition.includes('#updatedAt = :updatedAt') && previous.updatedAt !== input.ExpressionAttributeValues[':updatedAt']);
  if (conflict) throw Object.assign(new Error('Synthetic conditional conflict'), { name: 'ConditionalCheckFailedException' });
  records.set(key, structuredClone(input.Item));
  if (input.Item.status === 'assinada') successfulSignWrites += 1;
  return {};
});

process.env.TABLE_NAME = 'synthetic-capture-only';
process.env.AWS_REGION = 'sa-east-1';
process.env.NODE_ENV = 'test';
process.env.COGNITO_ISSUER = 'https://cognito-idp.sa-east-1.amazonaws.com/synthetic-pool';
process.env.COGNITO_CLIENT_ID = 'synthetic-client';
process.env.AUTH_COMPANY_CLAIM = 'custom:empresa_id';
const { handler } = await import('../src/lambda.js');
const store = await import('../src/db/store.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const SECOND_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAAIUlEQVR4nGMUDTdnoCVgoqnpoxaMWjBqwagFoxaMWgAFANggAMdjh1zKAAAAAElFTkSuQmCC';
const company = 'synthetic-company-A';
const claims = {
  sub: 'synthetic-operator-A', iss: process.env.COGNITO_ISSUER, aud: process.env.COGNITO_CLIENT_ID,
  exp: String(Math.floor(Date.now() / 1000) + 3600), token_use: 'id',
  'cognito:groups': '[EMPRESA]', 'custom:empresa_id': company
};
const payload = () => ({ imageDataUrl: PNG, dedo: 'R_INDEX', captureRequestId: randomUUID() });

async function request(id, body, auth = claims, selected = company) {
  const path = `/api/fichas/${id}/assinar`;
  const event = {
    version: '2.0', routeKey: 'ANY /{proxy+}', rawPath: path, rawQueryString: '',
    headers: { host: 'synthetic.invalid', 'content-type': 'application/json', ...(selected ? { 'x-empresa-id': selected } : {}) },
    requestContext: {
      requestId: randomUUID(), stage: '$default', http: { method: 'POST', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' },
      ...(auth ? { authorizer: { jwt: { claims: auth } } } : {})
    }, isBase64Encoded: false, body: JSON.stringify(body)
  };
  const result = await handler(event, {});
  return { status: result.statusCode, body: JSON.parse(result.body) };
}

async function pending() {
  return store.create('ficha', { empresaId: company, trabalhadorId: 'synthetic-worker', status: 'pendente', itens: [{ epiId: 'synthetic-epi', quantidade: 1 }] });
}

function collide(ficha) {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  simultaneousWrite = { key: ficha.pk, ready, release, arrived: 0 };
}

test('reenvio idêntico retorna o mesmo registro sem nova gravação e sem confiar nas alegações do cliente', async () => {
  const ficha = await pending(), body = payload(), before = successfulSignWrites;
  const first = await request(ficha.id, { ...body, verificada: true, matchScore: 100, signedAt: 'forjada', capturadoPor: 'outro', captureRequestHash: 'forjado' });
  const replay = await request(ficha.id, body);
  assert.equal(first.status, 200); assert.equal(first.body.replayed, false);
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.item, first.body.item);
  assert.equal(successfulSignWrites - before, 1);
  const capture = first.body.item.assinaturaBiometrica;
  assert.equal(capture.verificada, false); assert.equal(capture.matchScore, undefined);
  assert.equal(capture.capturadoPor, claims.sub); assert.notEqual(capture.signedAt, 'forjada');
  assert.notEqual(capture.captureRequestHash, 'forjado');
});

test('mesmo UUID com outra imagem, dedo ou ator é conflito; novo UUID não substitui assinatura', async () => {
  const ficha = await pending(), body = payload();
  const saved = await request(ficha.id, body);
  for (const [changed, actor] of [
    [{ ...body, imageDataUrl: SECOND_PNG }, claims],
    [{ ...body, dedo: 'L_INDEX' }, claims],
    [body, { ...claims, sub: 'synthetic-operator-B' }],
    [{ ...body, captureRequestId: randomUUID() }, claims]
  ]) assert.equal((await request(ficha.id, changed, actor)).status, 409);
  assert.deepEqual(await store.get('ficha', ficha.id), saved.body.item);
});

test('replay confere autenticação, empresa e ficha antes de devolver a captura', async () => {
  const ficha = await pending(), body = payload();
  await request(ficha.id, body);
  assert.equal((await request(ficha.id, body, null)).status, 401);
  assert.equal((await request(ficha.id, body, { ...claims, 'custom:empresa_id': 'synthetic-company-B' }, 'synthetic-company-B')).status, 403);
  assert.equal((await request(ficha.id, body, claims, 'synthetic-company-B')).status, 403);
  assert.equal((await request('missing-ficha', body)).status, 404);
  const another = await pending();
  const savedOther = await request(another.id, { ...body, captureRequestId: randomUUID() });
  assert.equal((await request(another.id, body)).status, 409);
  assert.deepEqual(await store.get('ficha', another.id), savedOther.body.item);
});

test('duas confirmações iguais simultâneas gravam uma vez e recuperam o mesmo registro após conflito', { timeout: 5000 }, async () => {
  const ficha = await pending(), body = payload(), before = successfulSignWrites;
  collide(ficha);
  try {
    const results = await Promise.all([request(ficha.id, body), request(ficha.id, body)]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    assert.deepEqual(results.map(result => result.body.replayed).sort(), [false, true]);
    assert.deepEqual(results[0].body.item, results[1].body.item);
    assert.equal(successfulSignWrites - before, 1);
    assert.equal((await store.get('ficha', ficha.id))._version, 2);
  } finally { simultaneousWrite = null; }
});

test('capturas diferentes simultâneas preservam a primeira e recusam a segunda pelo bloqueio otimista', { timeout: 5000 }, async () => {
  const ficha = await pending(), body = payload(), other = { ...body, imageDataUrl: SECOND_PNG }, before = successfulSignWrites;
  collide(ficha);
  try {
    const results = await Promise.all([request(ficha.id, body), request(ficha.id, other)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const accepted = results.find(result => result.status === 200);
    assert.deepEqual(await store.get('ficha', ficha.id), accepted.body.item);
    assert.equal(successfulSignWrites - before, 1);
  } finally { simultaneousWrite = null; }
});

test('contrato legado sem UUID continua permitido e não ganha replay; cancelamento não é revertido', async () => {
  const ficha = await pending(), body = { image: PNG, dedo: 'R_INDEX' };
  const result = await request(ficha.id, body);
  assert.equal(result.status, 200); assert.equal(result.body.item.assinaturaBiometrica.captureRequestId, undefined);
  assert.equal((await request(ficha.id, body)).status, 409);
  assert.equal((await request(ficha.id, {})).status, 409);
  const tracked = await pending(), trackedBody = payload();
  const signed = (await request(tracked.id, trackedBody)).body.item;
  const cancelled = await store.update('ficha', tracked.id, { status: 'cancelada', statusAnterior: 'assinada' }, { expectedVersion: signed._version });
  assert.equal((await request(tracked.id, trackedBody)).status, 409);
  assert.deepEqual(await store.get('ficha', tracked.id), cancelled);
});

test('imagem ou identificador inválido deixam a ficha pendente e sem gravação parcial', async () => {
  const ficha = await pending(), before = successfulSignWrites;
  assert.equal((await request(ficha.id, { ...payload(), imageDataUrl: 'data:image/png;base64,aGVsbG8=' })).status, 400);
  assert.equal((await request(ficha.id, { ...payload(), captureRequestId: 'invalido' })).status, 400);
  assert.deepEqual(await store.get('ficha', ficha.id), ficha);
  assert.equal(successfulSignWrites, before);
});
