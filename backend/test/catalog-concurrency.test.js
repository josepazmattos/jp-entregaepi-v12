import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic, in-process API; no AWS account, credentials or real business records.
delete process.env.TABLE_NAME;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.NODE_ENV = 'test';
process.env.DATA_MODE = 'memory';
process.env.COGNITO_ISSUER = 'https://cognito-idp.sa-east-1.amazonaws.com/test-pool';
process.env.COGNITO_CLIENT_ID = 'synthetic-client';
process.env.AUTH_COMPANY_CLAIM = 'custom:empresa_id';
const { handler } = await import('../src/lambda.js');
const { create, list } = await import('../src/db/store.js');

async function contribute(company, actor) {
  const path = '/api/epis';
  const claims = { sub: actor, iss: process.env.COGNITO_ISSUER, aud: process.env.COGNITO_CLIENT_ID, token_use: 'id', exp: String(Math.floor(Date.now() / 1000) + 3600), 'cognito:groups': '[EMPRESA]', 'custom:empresa_id': company };
  const event = {
    version: '2.0', routeKey: 'ANY /{proxy+}', rawPath: path, rawQueryString: '',
    headers: { host: 'local-test.invalid', 'content-type': 'application/json', 'x-empresa-id': company },
    requestContext: { requestId: actor, stage: '$default', http: { method: 'POST', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' }, authorizer: { jwt: { claims } } },
    isBase64Encoded: false,
    body: JSON.stringify({ ca: '8112233', descricao: 'EQUIPAMENTO SINTÉTICO COMPARTILHADO', modelo: 'MODELO SINTÉTICO', tamanho: 'M' })
  };
  const response = await handler(event, {});
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test('duas empresas que cadastram simultaneamente o mesmo equipamento reutilizam um único item sem conflito de idempotência', async () => {
  const a = await create('empresa', { nome: 'EMPRESA SINTÉTICA A' });
  const b = await create('empresa', { nome: 'EMPRESA SINTÉTICA B' });
  const responses = await Promise.all([contribute(a.id, 'actor-A'), contribute(b.id, 'actor-B')]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(responses[0].body.item.id, responses[1].body.item.id);
  assert.equal((await list('epi')).length, 1);
  assert.ok(responses.every(response => !('criadoPor' in response.body.item) && !('empresaId' in response.body.item)));
});
