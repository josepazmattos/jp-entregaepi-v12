import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import serverlessHttp from 'serverless-http';
import { createStore } from '../src/db/store.js';
import { createEmpresasRouter } from '../src/routes/empresas.routes.js';
import { fichaSnapshots } from '../src/services/ficha.service.js';

const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBxkAAAAASUVORK5CYII=';

function setup() {
  const storage = createStore({ allowMemory: true });
  const state = { failAccount: false, accountCalls: 0 };
  const accounts = {
    assertReady() {}, async inspect() { return null; },
    async ensureCompanyAccess({ companyId, login }) {
      state.accountCalls++;
      if (state.failAccount) throw new Error('Synthetic provider failure');
      return { sub: `synthetic-${companyId}`, username: login, status: 'FORCE_CHANGE_PASSWORD' };
    }
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = req.headers['x-test-profile'] === 'MASTER'
      ? { sub: 'synthetic-master', master: true, empresaIds: [] }
      : { sub: 'synthetic-company', master: false, empresaIds: [req.headers['x-test-company']] };
    next();
  });
  app.use('/api/empresas', createEmpresasRouter({ storage, accounts }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ ok: false, code: error.code || 'ERRO_INTERNO' }));
  const handler = serverlessHttp(app);
  async function request(method, path, { body, master = true, company = '' } = {}) {
    const response = await handler({
      version: '2.0', routeKey: 'ANY /{proxy+}', rawPath: path, rawQueryString: '',
      headers: { host: 'local-test.invalid', 'content-type': 'application/json', 'x-test-profile': master ? 'MASTER' : 'EMPRESA', 'x-test-company': company },
      requestContext: { requestId: 'synthetic-request', stage: '$default', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' } },
      isBase64Encoded: false, ...(body == null ? {} : { body: JSON.stringify(body) })
    }, {});
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }
  return { storage, state, request };
}

test('rotas empresas: MASTER cria e enxerga somente dados públicos de acesso na resposta', async () => {
  const { storage, request } = setup();
  const created = await request('POST', '/api/empresas', { body: { nome: 'EMPRESA SINTÉTICA', cnpj: '04252011000110', login: 'empresa.sintetica', requestId: 'synthetic-route-0001' } });
  assert.equal(created.status, 200);
  assert.equal(created.body.acesso.status, 'ativo');
  assert.equal(created.body.item.cognitoSub, undefined);
  assert.equal(created.body.item._accessRegistration, undefined);
  assert.equal(created.body.item.criadoPor, undefined);
  assert.ok((await storage.get('empresa', created.body.item.id)).cognitoSub);
  const listing = await request('GET', '/api/empresas');
  assert.equal(listing.status, 200);
  assert.equal(listing.body.items.length, 1);
  assert.equal(listing.body.items[0].cognitoSub, undefined);
});

test('rotas empresas: conta EMPRESA edita sua logo e recebe403 para criar, provisionar ou alterar outra empresa', async () => {
  const { storage, request, state } = setup();
  const own = await storage.create('empresa', { nome: 'EMPRESA PRÓPRIA', cnpj: '04252011000110', logoUrl: 'https://legacy.invalid/logo.png' });
  const foreign = await storage.create('empresa', { nome: 'OUTRA EMPRESA', cnpj: '11222333000181' });
  const auth = { master: false, company: own.id };
  const listing = await request('GET', '/api/empresas', auth);
  assert.deepEqual(listing.body.items.map(item => item.id), [own.id]);
  assert.equal((await request('GET', `/api/empresas/${foreign.id}`, auth)).status, 403);
  assert.equal((await request('POST', '/api/empresas', { ...auth, body: { nome: 'NÃO GRAVAR' } })).status, 403);
  assert.equal((await request('POST', `/api/empresas/${own.id}/acesso`, { ...auth, body: {} })).status, 403);
  assert.equal((await request('PATCH', `/api/empresas/${foreign.id}`, { ...auth, body: { nome: 'NÃO GRAVAR' } })).status, 403);
  const updated = await request('PATCH', `/api/empresas/${own.id}`, { ...auth, body: { logoDataUrl: logo, _version: own._version } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.logoDataUrl, logo);
  assert.equal(updated.body.item.logoUrl, '');
  const snapshot = fichaSnapshots(await storage.get('empresa', own.id), { nomeCompleto: 'TRABALHADOR SINTÉTICO' });
  assert.equal(snapshot.empresaSnapshot.logoDataUrl, logo);
  assert.equal(snapshot.empresaSnapshot.nome, own.nome);
  assert.equal(state.accountCalls, 0);
});

test('rotas empresas: versão antiga e imagem remota não sobrescrevem dados', async () => {
  const { storage, request } = setup();
  const company = await storage.create('empresa', { nome: 'EMPRESA SINTÉTICA' });
  await storage.update('empresa', company.id, { responsavel: 'ATUALIZADO' });
  const stale = await request('PATCH', `/api/empresas/${company.id}`, { body: { nome: 'NÃO GRAVAR', _version: company._version } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'REGISTRO_ALTERADO');
  const remote = await request('PATCH', `/api/empresas/${company.id}`, { body: { logoUrl: 'https://external.invalid/logo.png' } });
  assert.equal(remote.status, 400);
  assert.equal((await storage.get('empresa', company.id)).nome, company.nome);
});

test('rotas empresas: provisionamento parcial responde202 e Retomar conclui o mesmo cadastro', async () => {
  const { storage, request, state } = setup();
  state.failAccount = true;
  const pending = await request('POST', '/api/empresas', { body: { nome: 'EMPRESA SINTÉTICA', cnpj: '04252011000110', requestId: 'synthetic-route-0002' } });
  assert.equal(pending.status, 202);
  assert.equal(pending.body.acesso.status, 'pendente');
  assert.ok(pending.body.warning.includes('Retomar acesso'));
  state.failAccount = false;
  const ready = await request('POST', `/api/empresas/${pending.body.item.id}/acesso`, { body: {} });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.acesso.status, 'ativo');
  assert.equal(ready.body.item.id, pending.body.item.id);
  assert.equal((await storage.list('empresa')).length, 1);
});
