import test from 'node:test';
import assert from 'node:assert/strict';
import { TERMO_APROVADO } from '../src/services/ficha-modelo.js';

// These tests use only an isolated in-process store and synthetic records.
delete process.env.TABLE_NAME;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.NODE_ENV = 'test';
process.env.DATA_MODE = 'memory';
process.env.APP_VERSION = '12.7.1';
process.env.BUILD_SHA = 'synthetic-test-build';
process.env.COGNITO_ISSUER = 'https://cognito-idp.sa-east-1.amazonaws.com/test-pool';
process.env.COGNITO_CLIENT_ID = 'synthetic-client';
process.env.AUTH_COMPANY_CLAIM = 'custom:empresa_id';
const { handler } = await import('../src/lambda.js');

const basicClaims = { sub: 'synthetic-master', iss: process.env.COGNITO_ISSUER, aud: process.env.COGNITO_CLIENT_ID, token_use: 'id', exp: String(Math.floor(Date.now() / 1000) + 3600) };
const masterClaims = { ...basicClaims, 'cognito:groups': '[MASTER]' };

async function request(method, path, { body, company, claims = masterClaims, headers = {} } = {}) {
  const event = {
    version: '2.0', routeKey: 'ANY /{proxy+}', rawPath: path, rawQueryString: '',
    headers: { host: 'local-test.invalid', 'content-type': 'application/json', ...(company ? { 'x-empresa-id': company } : {}), ...headers },
    requestContext: { requestId: 'synthetic-request', stage: '$default', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' }, ...(claims ? { authorizer: { jwt: { claims } } } : {}) },
    isBase64Encoded: false,
    ...(body == null ? {} : { body: JSON.stringify(body) })
  };
  const response = await handler(event, {});
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test('API Lambda: autorização, empresa, emissão e captura em isolamento local', async t => {
  let companyA, companyB, workerA, workerB, epiA, epiB, ficha;
  await t.test('rotas públicas respondem, privadas sem contexto do gateway recusam acesso', async () => {
    const health = await request('GET', '/health', { claims: null });
    assert.equal(health.status, 200);
    assert.equal(health.body.mode, 'memory');
    assert.equal(health.body.durable, false);
    assert.equal(health.body.buildSha, 'synthetic-test-build');
    const ca = await request('GET', '/api/caepi/365', { claims: null });
    assert.equal(ca.status, 200);
    assert.equal(ca.body.item.live, false);
    const forbidden = await request('GET', '/api/empresas', { claims: null, headers: { authorization: 'Bearer simulated', 'x-authorizer-claims': JSON.stringify(masterClaims) } });
    assert.equal(forbidden.status, 401);
    assert.equal((await request('GET', '/api/empresas', { claims: basicClaims })).status, 403);
  });
  await t.test('cadastros usam ID gerado pelo servidor e vínculo existente', async () => {
    const a = await request('POST', '/api/empresas', { body: { id: 'client-provided', nome: 'EMPRESA SINTÉTICA A', localidade: 'CIDADE SINTÉTICA' } });
    assert.equal(a.status, 200);
    companyA = a.body.item.id;
    assert.notEqual(companyA, 'client-provided');
    companyB = (await request('POST', '/api/empresas', { body: { nome: 'EMPRESA SINTÉTICA B' } })).body.item.id;
    const workerBody = { nomeCompleto: 'TRABALHADOR SINTÉTICO', cpf: '000.000.000-00', funcao: 'FUNÇÃO SINTÉTICA', matriculaESocial: 'TESTE-000', localidade: 'CIDADE SINTÉTICA' };
    workerA = (await request('POST', '/api/trabalhadores', { company: companyA, body: workerBody })).body.item;
    workerB = (await request('POST', '/api/trabalhadores', { company: companyB, body: workerBody })).body.item;
    epiA = (await request('POST', '/api/epis', { company: companyA, body: { ca: '700001', descricao: 'EPI SINTÉTICO A' } })).body.item;
    epiB = (await request('POST', '/api/epis', { company: companyB, body: { ca: '700002', descricao: 'EPI SINTÉTICO B' } })).body.item;
    assert.equal((await request('POST', '/api/trabalhadores', { company: 'missing-company', body: workerBody })).status, 404);
  });
  await t.test('conta EMPRESA enxerga somente seu vínculo e não cria empresa', async () => {
    const claims = { ...basicClaims, sub: 'synthetic-company-user', 'cognito:groups': '[EMPRESA]', 'custom:empresa_id': companyA };
    const companies = await request('GET', '/api/empresas', { claims });
    assert.deepEqual(companies.body.items.map(item => item.id), [companyA]);
    const workers = await request('GET', '/api/trabalhadores', { claims });
    assert.deepEqual(workers.body.items.map(item => item.id), [workerA.id]);
    assert.equal((await request('GET', '/api/trabalhadores', { claims, company: companyB })).status, 403);
    assert.equal((await request('POST', '/api/empresas', { claims, body: { nome: 'NÃO CRIAR' } })).status, 403);
    assert.equal((await request('GET', '/api/auditoria', { claims })).status, 403);
  });
  await t.test('ficha rejeita trabalhador/EPI de outra empresa e quantidade inválida', async () => {
    const base = { trabalhadorId: workerA.id, itens: [{ epiId: epiA.id, quantidade: 1 }] };
    assert.equal((await request('POST', '/api/fichas', { company: companyA, body: { ...base, trabalhadorId: workerB.id } })).status, 403);
    assert.equal((await request('POST', '/api/fichas', { company: companyA, body: { ...base, itens: [{ epiId: epiB.id, quantidade: 1 }] } })).status, 403);
    assert.equal((await request('POST', '/api/fichas', { company: companyA, body: { ...base, itens: [{ epiId: epiA.id, quantidade: -1 }] } })).status, 400);
    assert.equal((await request('POST', '/api/fichas', { company: companyA, body: { ...base, data: '31/02/2026' } })).status, 400);
    assert.equal((await request('POST', '/api/fichas', { company: companyA, body: { ...base, modeloFicha: { id: 'JP-DOCX-11.10.6', termoResponsabilidade: 'TEXTO ADULTERADO' } } })).status, 400);
  });
  await t.test('ficha preserva snapshots do cadastro e impede fabricar assinatura na emissão', async () => {
    const response = await request('POST', '/api/fichas', { company: companyA, body: {
      trabalhadorId: workerA.id, tipo: 'Troca', data: '06/10/2026', itens: [{ epiId: epiA.id, quantidade: 2, epiDescricao: 'DESCRIÇÃO ADULTERADA' }],
      status: 'assinada', assinaturaBiometrica: { verificada: true }, trabalhadorSnapshot: { nomeCompleto: 'NOME ADULTERADO' },
      modeloFicha: { id: 'JP-DOCX-11.10.6', termoResponsabilidade: TERMO_APROVADO }
    } });
    assert.equal(response.status, 200);
    ficha = response.body.item;
    assert.equal(ficha.status, 'pendente');
    assert.equal(ficha.assinaturaBiometrica, undefined);
    assert.equal(ficha.trabalhadorSnapshot.nomeCompleto, workerA.nomeCompleto);
    assert.equal(ficha.trabalhadorSnapshot.funcao, workerA.funcao);
    assert.equal(ficha.trabalhadorSnapshot.matriculaESocial, workerA.matriculaESocial);
    assert.equal(ficha.itens[0].epiDescricao, epiA.descricao);
    assert.equal(ficha.tipo, 'Troca');
    assert.equal(ficha.modeloFicha.id, 'JP-DOCX-11.10.6');
    assert.equal(ficha.modeloFicha.termoResponsabilidade, TERMO_APROVADO);
  });
  await t.test('assinatura e exclusão conferem empresa; imagem alegada não prova biometria', async () => {
    const foreignClaims = { ...basicClaims, 'cognito:groups': '[EMPRESA]', 'custom:empresa_id': companyB };
    assert.equal((await request('POST', `/api/fichas/${ficha.id}/assinar`, { claims: foreignClaims, body: {} })).status, 403);
    assert.equal((await request('DELETE', `/api/fichas/${ficha.id}`, { claims: foreignClaims })).status, 403);
    assert.equal((await request('POST', `/api/fichas/${ficha.id}/assinar`, { company: companyA, body: { realFingerImage: 'invented', dedo: 'teste' } })).status, 400);
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBxkAAAAASUVORK5CYII=';
    const capture = await request('POST', `/api/fichas/${ficha.id}/assinar`, { company: companyA, body: { realFingerImage: true, fingerImageDataUrl: image, fingerCode: 'sintetico', verificada: true, matchScore: 100, signedAt: 'falsified' } });
    assert.equal(capture.status, 200);
    assert.equal(capture.body.item.status, 'assinada');
    assert.equal(capture.body.item.assinaturaBiometrica.verificada, false);
    assert.equal(capture.body.item.assinaturaBiometrica.realFingerImage, image);
    assert.equal(capture.body.item.assinaturaBiometrica.metodo, 'captura_de_imagem');
    assert.equal(capture.body.item.assinaturaBiometrica.capturadoPor, basicClaims.sub);
    assert.equal(capture.body.item.assinaturaBiometrica.matchScore, undefined);
    assert.notEqual(capture.body.item.assinaturaBiometrica.signedAt, 'falsified');
    const cancelled = await request('DELETE', `/api/fichas/${ficha.id}`, { company: companyA, body: { motivo: 'Cancelamento de teste local' } });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.item.status, 'cancelada');
    assert.equal(cancelled.body.item.statusAnterior, 'assinada');
    assert.equal((await request('POST', `/api/fichas/${ficha.id}/assinar`, { company: companyA, body: { realFingerImage: image, dedo: 'sintetico' } })).status, 409);
  });
});
