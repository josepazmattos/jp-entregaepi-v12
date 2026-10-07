import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/db/store.js';
import { createCompanyService } from '../src/services/empresa.service.js';
import { createCognitoAccounts, companyTemporaryPassword } from '../src/services/company-accounts.js';

const CNPJ = '04252011000110';
const actor = 'synthetic-master';
const registration = (overrides = {}) => ({ nome: 'EMPRESA SINTÉTICA', cnpj: CNPJ, login: 'empresa.sintetica', requestId: 'synthetic-request-0001', localidade: 'CIDADE SINTÉTICA', ...overrides });
const awsError = name => Object.assign(new Error('Synthetic provider failure'), { name });

function setup() {
  const storage = createStore({ allowMemory: true });
  const users = new Map(), calls = [], groups = new Set();
  const hooks = {};
  let created = 0;
  const client = { async send(command) {
    await Promise.resolve();
    const type = command.constructor.name, input = command.input;
    calls.push({ type, input: structuredClone(input) });
    if (type === 'AdminGetUserCommand') {
      if (hooks.beforeGet) await hooks.beforeGet(input);
      const user = users.get(input.Username);
      if (!user) throw awsError('UserNotFoundException');
      return structuredClone(user);
    }
    if (type === 'AdminCreateUserCommand') {
      if (hooks.beforeCreate) await hooks.beforeCreate(input);
      if (users.has(input.Username)) throw awsError('UsernameExistsException');
      created++;
      const user = { Username: input.Username, Enabled: true, UserStatus: 'FORCE_CHANGE_PASSWORD', UserAttributes: [
        { Name: 'sub', Value: `synthetic-sub-${created}` }, ...input.UserAttributes
      ] };
      users.set(input.Username, user);
      if (hooks.afterCreate) await hooks.afterCreate(input, user);
      return { User: { ...structuredClone(user), Attributes: user.UserAttributes } };
    }
    if (type === 'AdminAddUserToGroupCommand') {
      if (hooks.beforeGroup) await hooks.beforeGroup(input);
      groups.add(`${input.Username}:${input.GroupName}`);
      return {};
    }
    throw new Error(`Unexpected AWS command: ${type}`);
  } };
  const accounts = createCognitoAccounts({ client, userPoolId: 'sa-east-1_synthetic', companyClaim: 'custom:empresa_id' });
  const service = createCompanyService({ storage, accounts });
  return { storage, users, calls, groups, hooks, accounts, service, get created() { return created; } };
}
function assertNoCredentials(value) {
  const serialized = JSON.stringify(value);
  for (const secret of ['JpEpi1-Inicial-', 'TemporaryPassword', 'AccessToken', 'RefreshToken', 'cognitoSub', '_accessRegistration', 'startedBy']) assert.equal(serialized.includes(secret), false, secret);
}

test('empresa: cria acesso temporário vinculado ao UUID, sem convites, e oculta informações internas', async () => {
  const state = setup();
  const result = await state.service.register(registration({ id: 'injected', cognitoSub: 'injected', status: 'injected' }), actor);
  assert.equal(result.acesso.status, 'ativo');
  assert.notEqual(result.item.id, 'injected');
  assert.equal(result.item.status, 'Ativa');
  assert.equal(result.acesso.login, 'empresa.sintetica');
  assert.equal(result.acesso.trocaObrigatoria, true);
  assert.equal(result.acesso.convitesEnviados, false);
  assertNoCredentials(result);
  const create = state.calls.find(call => call.type === 'AdminCreateUserCommand').input;
  assert.equal(create.MessageAction, 'SUPPRESS');
  assert.equal(create.ForceAliasCreation, false);
  assert.equal(create.TemporaryPassword, 'JpEpi1-Inicial-04252011');
  assert.deepEqual(create.UserAttributes, [{ Name: 'custom:empresa_id', Value: result.item.id }]);
  assert.deepEqual([...state.groups], ['empresa.sintetica:EMPRESA']);
  const stored = await state.storage.get('empresa', result.item.id);
  assert.equal(stored.cognitoSub, 'synthetic-sub-1');
  assert.equal(JSON.stringify(stored).includes('JpEpi1-Inicial-'), false);
  assert.equal(stored.masterUsuario, undefined);
});

test('senha inicial conserva zeros e aplica a mesma convenção ao CNPJ alfanumérico oficial', () => {
  assert.equal(companyTemporaryPassword('04.252.011/0001-10'), 'JpEpi1-Inicial-04252011');
  assert.equal(companyTemporaryPassword('12.abc.345/01de-35'), 'JpEpi1-Inicial-12ABC345');
});

test('mesma solicitação repetida em paralelo produz uma empresa e uma conta, sem redefinir senha', async () => {
  const state = setup();
  const results = await Promise.all(Array.from({ length: 4 }, () => state.service.register(registration(), actor)));
  assert.equal(new Set(results.map(result => result.item.id)).size, 1);
  assert.ok(results.every(result => result.acesso.status === 'ativo'));
  assert.equal((await state.storage.list('empresa')).length, 1);
  assert.equal(state.users.size, 1);
  assert.equal(state.created, 1);
  const repeated = await state.service.register(registration(), actor);
  assert.equal(repeated.item.id, results[0].item.id);
  assert.ok(state.calls.every(call => ['AdminGetUserCommand', 'AdminCreateUserCommand', 'AdminAddUserToGroupCommand'].includes(call.type)));
});

test('login Cognito preexistente é recusado antes da reserva e nunca recebe vínculo ou grupo', async () => {
  const state = setup();
  state.users.set('empresa.sintetica', { Username: 'empresa.sintetica', Enabled: true, UserStatus: 'CONFIRMED', UserAttributes: [{ Name: 'sub', Value: 'foreign-sub' }] });
  await assert.rejects(state.service.register(registration(), actor), error => error.code === 'LOGIN_JA_UTILIZADO' && error.status === 409);
  assert.equal((await state.storage.list('empresa')).length, 0);
  assert.equal(state.created, 0);
  assert.equal(state.groups.size, 0);
  assert.equal(state.users.get('empresa.sintetica').UserAttributes.length, 1);
});

test('timeout depois da criação é retomado pela reserva e pelo vínculo imutável, sem criar outra conta', async () => {
  const state = setup();
  state.hooks.afterCreate = async () => { delete state.hooks.afterCreate; throw awsError('TimeoutError'); };
  const pending = await state.service.register(registration(), actor);
  assert.equal(pending.acesso.status, 'pendente');
  assert.equal(state.created, 1);
  assertNoCredentials(pending);
  const ready = await state.service.register(registration(), actor);
  assert.equal(ready.item.id, pending.item.id);
  assert.equal(ready.acesso.status, 'ativo');
  assert.equal(state.created, 1);
});

test('falha ao adicionar grupo retém a conta e conclui na retomada sem resetar a senha', async () => {
  const state = setup();
  state.hooks.beforeGroup = async () => { delete state.hooks.beforeGroup; throw awsError('InternalErrorException'); };
  const pending = await state.service.register(registration(), actor);
  assert.equal(pending.acesso.status, 'pendente');
  assert.equal((await state.storage.get('empresa', pending.item.id)).cognitoSub, 'synthetic-sub-1');
  const ready = await state.service.resume(pending.item.id, {}, actor);
  assert.equal(ready.acesso.status, 'ativo');
  assert.equal(state.created, 1);
  assert.equal(state.groups.size, 1);
});

test('falha ao confirmar DynamoDB retoma exatamente a conta que já foi criada', async () => {
  const state = setup(), originalUpdate = state.storage.update;
  let failOnce = true;
  state.storage.update = async (...args) => {
    if (args[2].acessoStatus === 'ativo' && failOnce) { failOnce = false; throw awsError('TimeoutError'); }
    return originalUpdate(...args);
  };
  const pending = await state.service.register(registration(), actor);
  assert.equal(pending.acesso.status, 'pendente');
  assert.equal(state.created, 1);
  const ready = await state.service.resume(pending.item.id, {}, actor);
  assert.equal(ready.acesso.status, 'ativo');
  assert.equal(state.created, 1);
});

test('retomada recusa conta substituída ou vínculo estrangeiro, mesmo usando o mesmo login', async () => {
  const state = setup();
  state.hooks.beforeGroup = async () => { throw awsError('InternalErrorException'); };
  const pending = await state.service.register(registration(), actor);
  const account = state.users.get('empresa.sintetica');
  account.UserAttributes.find(attribute => attribute.Name === 'sub').Value = 'replacement-sub';
  delete state.hooks.beforeGroup;
  const blocked = await state.service.resume(pending.item.id, {}, actor);
  assert.equal(blocked.acesso.status, 'pendente');
  assert.equal(state.groups.size, 0);
  assert.equal(state.created, 1);
  assert.equal((await state.storage.get('empresa', pending.item.id)).cognitoSub, 'synthetic-sub-1');
});

test('corrida com conta estrangeira depois do preflight não vincula nem altera essa conta', async () => {
  const state = setup();
  state.hooks.beforeCreate = async input => {
    state.users.set(input.Username, { Username: input.Username, Enabled: true, UserStatus: 'CONFIRMED', UserAttributes: [{ Name: 'sub', Value: 'foreign-sub' }, { Name: 'custom:empresa_id', Value: 'foreign-company' }] });
  };
  const pending = await state.service.register(registration(), actor);
  assert.equal(pending.acesso.status, 'pendente');
  assert.equal(state.groups.size, 0);
  assert.equal(state.created, 0);
  assert.equal(state.users.get('empresa.sintetica').UserAttributes.at(-1).Value, 'foreign-company');
});

test('atualização de dados durante provisionamento não é sobrescrita ao confirmar o acesso', async () => {
  const state = setup();
  state.hooks.beforeGroup = async () => {
    const [company] = await state.storage.list('empresa');
    await state.storage.update('empresa', company.id, { responsavel: 'RESPONSÁVEL ATUALIZADO EM OUTRA SESSÃO' });
    delete state.hooks.beforeGroup;
  };
  const ready = await state.service.register(registration(), actor);
  assert.equal(ready.acesso.status, 'ativo');
  assert.equal(ready.item.responsavel, 'RESPONSÁVEL ATUALIZADO EM OUTRA SESSÃO');
});

test('empresa legada recebe acesso preservando ID, dados, trabalhadores e fichas existentes', async () => {
  const state = setup();
  const original = await state.storage.create('empresa', { nome: 'EMPRESA LEGADA SINTÉTICA', responsavel: 'RESPONSÁVEL LEGADO', cnpj: '04.252.011/0001-10' });
  const worker = await state.storage.create('trabalhador', { empresaId: original.id, nomeCompleto: 'TRABALHADOR LEGADO' });
  const ficha = await state.storage.create('ficha', { empresaId: original.id, trabalhadorId: worker.id, empresaSnapshot: { nome: original.nome } });
  const result = await state.service.resume(original.id, { requestId: 'synthetic-legacy-001', login: 'empresa.legada' }, actor);
  assert.equal(result.item.id, original.id);
  assert.equal(result.item.nome, original.nome);
  assert.equal(result.item.responsavel, original.responsavel);
  assert.equal(result.item.cnpj, CNPJ);
  assert.equal(result.acesso.status, 'ativo');
  assert.equal((await state.storage.list('empresa')).length, 1);
  assert.deepEqual(await state.storage.get('trabalhador', worker.id), worker);
  assert.deepEqual(await state.storage.get('ficha', ficha.id), ficha);
  assert.equal((await state.service.resume(original.id, {}, actor)).acesso.status, 'ativo');
  await assert.rejects(state.service.resume(original.id, { login: 'outro.login' }, actor), error => error.code === 'ACESSO_IDENTIDADE_IMUTAVEL');
});

test('mesma solicitação com outros dados, CNPJ repetido e login repetido não duplicam empresas', async () => {
  const state = setup();
  const first = await state.service.register(registration(), actor);
  await assert.rejects(state.service.register(registration({ nome: 'ALTERADA' }), actor), error => error.code === 'IDEMPOTENCIA_DIVERGENTE');
  await assert.rejects(state.service.register(registration({ requestId: 'synthetic-request-0002', login: 'outro.login' }), actor), error => error.code === 'CNPJ_DUPLICADO');
  await assert.rejects(state.service.register(registration({ requestId: 'synthetic-request-0003', cnpj: '11222333000181' }), actor), error => error.code === 'LOGIN_JA_UTILIZADO');
  assert.equal((await state.storage.list('empresa')).length, 1);
  assert.equal((await state.storage.get('empresa', first.item.id)).nome, 'EMPRESA SINTÉTICA');
});

test('edição mantém identidade imutável e dados internos fora da resposta', async () => {
  const state = setup();
  const ready = await state.service.register(registration(), actor);
  await assert.rejects(state.service.edit(ready.item.id, { cnpj: '11222333000181' }), error => error.code === 'ACESSO_IDENTIDADE_IMUTAVEL');
  await assert.rejects(state.service.edit(ready.item.id, { login: 'outro.login' }), error => error.code === 'ACESSO_IDENTIDADE_IMUTAVEL');
  const updated = await state.service.edit(ready.item.id, { responsavel: 'NOVO RESPONSÁVEL', cognitoSub: 'injected', acessoStatus: 'injected' });
  assert.equal(updated.responsavel, 'NOVO RESPONSÁVEL');
  assert.equal(updated.acessoStatus, 'ativo');
  assertNoCredentials(updated);
  await assert.rejects(state.service.edit(ready.item.id, { nome: 'NÃO GRAVAR' }, { expectedVersion: 1 }), error => error.code === 'REGISTRO_ALTERADO');
});

test('sem configuração de vínculo seguro não reserva empresa nem cria credenciais', async () => {
  const storage = createStore({ allowMemory: true });
  const accounts = createCognitoAccounts({ client: { send: async () => { throw new Error('Should not be called'); } }, userPoolId: 'synthetic', companyClaim: '' });
  const service = createCompanyService({ storage, accounts });
  await assert.rejects(service.register(registration(), actor), error => error.code === 'ACESSO_NAO_CONFIGURADO');
  assert.equal((await storage.list('empresa')).length, 0);
});


test('conflito final de versão não declara acesso ativo quando o registro foi vinculado a outro sub', async () => {
  const state = setup();
  state.hooks.beforeGroup = async () => {
    const [company] = await state.storage.list('empresa');
    await state.storage.update('empresa', company.id, { acessoStatus: 'ativo', cognitoSub: 'different-sub' });
    delete state.hooks.beforeGroup;
  };
  const result = await state.service.register(registration(), actor);
  assert.equal(result.acesso.status, 'pendente');
  assert.equal(result.item.acessoStatus, 'pendente');
  assert.ok(result.warning);
  assert.equal((await state.storage.get('empresa', result.item.id)).cognitoSub, 'different-sub');
});
