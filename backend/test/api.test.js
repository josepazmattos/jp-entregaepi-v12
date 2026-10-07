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
const storage = await import('../src/db/store.js');

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
    // Company account provisioning has its own injected Cognito tests; this API suite never calls AWS.
    const a = await storage.create('empresa', { id: 'client-provided', nome: 'EMPRESA SINTÉTICA A', localidade: 'CIDADE SINTÉTICA' });
    companyA = a.id;
    assert.notEqual(companyA, 'client-provided');
    companyB = (await storage.create('empresa', { nome: 'EMPRESA SINTÉTICA B' })).id;
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
  await t.test('upload XLSX exige autorização, faz prévia por empresa e confirma sem duplicar trabalhadores', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Trabalhadores');
    sheet.addRow(['Nome completo', 'CPF', 'Matrícula eSocial', 'Função', 'Localidade']);
    sheet.addRow(['ZÉLIA SINTÉTICA', '52998224725', '00002', 'FUNÇÃO SINTÉTICA', 'CIDADE SINTÉTICA']);
    sheet.addRow(['ÁLVARO SINTÉTICO', '11144477735', '00003', 'FUNÇÃO SINTÉTICA', 'CIDADE SINTÉTICA']);
    const body = { arquivoNome: 'trabalhadores-sinteticos.xlsx', arquivoBase64: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') };
    const claims = { ...basicClaims, sub: 'synthetic-company-user', 'cognito:groups': '[EMPRESA]', 'custom:empresa_id': companyA };
    assert.equal((await request('POST', '/api/trabalhadores/importacao/previa', { claims: null, company: companyA, body })).status, 401);
    const preview = await request('POST', '/api/trabalhadores/importacao/previa', { claims, body });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.resumo.criar, 2);
    assert.equal((await request('GET', '/api/trabalhadores', { claims })).body.items.length, 1);
    const path = `/api/trabalhadores/importacao/${preview.body.importacaoId}`;
    const otherClaims = { ...claims, sub: 'synthetic-company-B-user', 'custom:empresa_id': companyB };
    assert.equal((await request('GET', path, { claims: otherClaims })).status, 404);
    assert.equal((await request('POST', `${path}/confirmar`, { claims: otherClaims, body: {} })).status, 404);
    const confirmed = await request('POST', `${path}/confirmar`, { claims, body: {} });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.status, 'concluida');
    assert.equal((await request('POST', `${path}/confirmar`, { claims, body: {} })).status, 200);
    const workers = await request('GET', '/api/trabalhadores', { claims });
    assert.deepEqual(workers.body.items.map(item => item.nomeCompleto), ['ÁLVARO SINTÉTICO', 'TRABALHADOR SINTÉTICO', 'ZÉLIA SINTÉTICA']);
    assert.equal((await request('POST', '/api/trabalhadores/importacao/previa', { claims, body: { arquivoNome: 'nao-e-planilha.xlsx', arquivoBase64: 'invalid' } })).status, 400);
  });
  await t.test('catálogo técnico é global, não revela autoria e deduplica contribuição simultânea', async () => {
    const claims = { ...basicClaims, sub: 'synthetic-company-user', 'cognito:groups': '[EMPRESA]', 'custom:empresa_id': companyA };
    const catalog = await request('GET', '/api/epis', { claims });
    assert.deepEqual(new Set(catalog.body.items.map(item => item.id)), new Set([epiA.id, epiB.id]));
    assert.ok(catalog.body.items.every(item => item.catalogoCompartilhado && !('empresaId' in item) && !('criadoPor' in item) && !('observacoes' in item)));
    const body = { ca: '700003', descricao: 'EPI COMPARTILHADO SINTÉTICO', modelo: 'MODELO TESTE', tamanho: 'M', empresaId: companyB, criadoPor: 'forged-creator', observacoes: 'NOTA PRIVADA' };
    const [one, two] = await Promise.all([
      request('POST', '/api/epis', { body, company: companyB }),
      request('POST', '/api/epis', { body, company: companyB })
    ]);
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    assert.equal(one.body.item.id, two.body.item.id);
    assert.equal(JSON.stringify(one.body.item).includes('forged-creator'), false);
    assert.equal(JSON.stringify(one.body.item).includes('NOTA PRIVADA'), false);
    assert.equal((await request('GET', '/api/epis', { claims, company: companyB })).status, 403);
    assert.equal((await request('GET', '/api/epis', { claims: null })).status, 401);
  });
  await t.test('equipamento sem CA pode ser cadastrado pelo Master sem empresa e usado na ficha', async () => {
    const equipment = await request('POST', '/api/epis', { body: { tipo: 'sem_ca', descricao: 'BOLSA DE FERRAMENTAS SINTÉTICA', validade: '2030-01-01' } });
    assert.equal(equipment.status, 200);
    assert.equal(equipment.body.item.ca, '');
    assert.equal(equipment.body.item.validade, '');
    const emission = await request('POST', '/api/fichas', { company: companyA, body: { trabalhadorId: workerA.id, itens: [{ epiId: equipment.body.item.id, quantidade: 1 }] } });
    assert.equal(emission.status, 200);
    assert.equal(emission.body.item.itens[0].ca, '');
    assert.equal(emission.body.item.itens[0].validade, '');
    assert.equal((await request('POST', '/api/epis', { body: { descricao: 'SEM TIPO E SEM CA' } })).status, 400);
  });
  await t.test('ficha isola trabalhador, aceita catálogo compartilhado e rejeita EPI ausente/quantidade inválida', async () => {
    const base = { trabalhadorId: workerA.id, itens: [{ epiId: epiA.id, quantidade: 1 }] };
    assert.equal((await request('POST', '/api/fichas', { company: companyA, body: { ...base, trabalhadorId: workerB.id } })).status, 403);
    const shared = await request('POST', '/api/fichas', { company: companyA, body: { ...base, itens: [{ epiId: epiB.id, quantidade: 1 }] } });
    assert.equal(shared.status, 200);
    assert.equal(shared.body.item.itens[0].epiDescricao, epiB.descricao);
    assert.equal((await request('POST', '/api/fichas', { company: companyA, body: { ...base, itens: [{ epiId: 'missing-equipment', quantidade: 1 }] } })).status, 404);
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
    assert.equal((await request('POST', `/api/fichas/${ficha.id}/assinar`, { company: companyA, body: {realFingerImage:'invented',verificada:true} })).status,403);
    assert.equal((await storage.get('ficha',ficha.id)).status,'pendente');
    // Historical image-only signatures remain cancellable and are never upgraded by assertion.
    await storage.update('ficha',ficha.id,{status:'assinada',assinaturaBiometrica:{verificada:false,metodo:'captura_de_imagem'}});
    const cancelled = await request('DELETE', `/api/fichas/${ficha.id}`, { company: companyA, body: { motivo: 'Cancelamento de teste local' } });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.item.status, 'cancelada');
    assert.equal(cancelled.body.item.statusAnterior, 'assinada');
    assert.equal((await request('POST', `/api/fichas/${ficha.id}/assinar`, { company: companyA, body: { realFingerImage: 'invented', dedo: 'sintetico' } })).status, 403);
  });
});
