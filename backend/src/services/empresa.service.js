import { httpError } from '../middleware/auth.js';
import { textField } from '../routes/_helpers.js';
import { companyEditableFields, normalizeCnpj, normalizeCompanyLogin } from './empresa-validation.js';

const publicFields = ['id', 'nome', 'cnpj', 'login', 'localidade', 'uf', 'responsavel', 'email', 'telefone', 'logoDataUrl', 'logoUrl', 'logo', 'status', 'acessoStatus', 'createdAt', 'updatedAt', '_version'];
export function publicCompany(item) {
  if (!item) return null;
  return Object.fromEntries(publicFields.filter(key => item[key] != null).map(key => [key, item[key]]));
}

function registrationKey(value) {
  const key = textField(value, { required: true, field: 'Identificador do cadastro', max: 100 });
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw httpError(400, 'O identificador do cadastro é inválido. Atualize a tela e tente novamente.', 'CADASTRO_IDENTIFICADOR_INVALIDO');
  return key;
}

function pendingCode(error) {
  if (['LOGIN_JA_UTILIZADO', 'ACESSO_REQUER_REVISAO'].includes(error.code)) return error.code;
  return 'ACESSO_PROVISIONAMENTO_PENDENTE';
}

export function createCompanyService({ storage, accounts }) {
  function result(item, warning = '') {
    const status = item.acessoStatus === 'ativo' ? 'ativo' : 'pendente';
    return {
      item: publicCompany(item),
      acesso: { login: item.login || '', status, senhaInicial: 'primeiros8Cnpj', trocaObrigatoria: true, convitesEnviados: false },
      ...(warning ? { warning } : {})
    };
  }
  async function company(id) {
    const item = await storage.get('empresa', id);
    if (!item) throw httpError(404, 'Empresa não encontrada.', 'EMPRESA_NAO_ENCONTRADA');
    return item;
  }
  function assertRegistration(item) {
    if (!item._accessRegistration?.requestId || !item._accessRegistration?.startedBy || !item.login || !item.cnpj) {
      throw httpError(409, 'Informe o CNPJ e o login para criar o acesso desta empresa.', 'ACESSO_CADASTRO_NECESSARIO');
    }
    if (normalizeCnpj(item.cnpj) !== item.cnpj || normalizeCompanyLogin(item.login) !== item.login) {
      throw httpError(409, 'O cadastro de acesso precisa de revisão administrativa.', 'ACESSO_REQUER_REVISAO');
    }
  }
  async function updateAccess(item, changes) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await storage.update('empresa', item.id, changes, { expectedVersion: item._version });
      } catch (error) {
        if (error.code !== 'REGISTRO_ALTERADO') throw error;
        const current = await company(item.id);
        if (current.login !== item.login || current.cnpj !== item.cnpj || current._accessRegistration?.requestId !== item._accessRegistration?.requestId) throw error;
        if (current.acessoStatus === 'ativo') {
          if (changes.cognitoSub && current.cognitoSub !== changes.cognitoSub) throw httpError(409, 'O vínculo de acesso foi alterado. Solicite revisão administrativa.', 'ACESSO_REQUER_REVISAO');
          return current;
        }
        item = current;
      }
    }
    throw httpError(409, 'O cadastro foi atualizado em outra sessão. Atualize a tela e retome o acesso.', 'REGISTRO_ALTERADO');
  }
  async function provision(item) {
    assertRegistration(item);
    if (item.acessoStatus === 'ativo' && item.cognitoSub) return result(item);
    accounts.assertReady();
    let account;
    try {
      account = await accounts.ensureCompanyAccess({ companyId: item.id, login: item.login, cnpj: item.cnpj, expectedSub: item.cognitoSub || '' });
    } catch (error) {
      const changes = { acessoStatus: 'pendente', acessoErro: pendingCode(error) };
      if (error.accountIdentity?.sub && (!item.cognitoSub || item.cognitoSub === error.accountIdentity.sub)) changes.cognitoSub = error.accountIdentity.sub;
      try { item = await updateAccess(item, changes); }
      catch { /* The durable reservation is still sufficient for a later safe retry. */ }
      if (item.acessoStatus === 'ativo') return result(item);
      const warning = pendingCode(error) === 'LOGIN_JA_UTILIZADO'
        ? 'Empresa salva. O login escolhido já pertence a outra conta; o acesso existente foi preservado. Solicite revisão ao administrador.'
        : pendingCode(error) === 'ACESSO_REQUER_REVISAO'
          ? 'Empresa salva. A conta vinculada precisa de revisão administrativa antes de liberar o acesso.'
          : 'Empresa salva. A criação do acesso está pendente; use Retomar acesso para concluir.';
      return result(item, warning);
    }
    try {
      item = await updateAccess(item, { acessoStatus: 'ativo', acessoErro: '', cognitoSub: account.sub, acessoCriadoEm: new Date().toISOString() });
      return result(item);
    } catch {
      // The Cognito account may already exist. A retry validates its immutable binding
      // and completes this record without generating or resetting another password.
      return result(item, 'O acesso foi criado, mas a confirmação do cadastro está pendente. Use Retomar acesso para concluir.');
    }
  }
  async function prepare(body, actorSub, existing = null) {
    accounts.assertReady();
    const requestId = registrationKey(body.requestId);
    const cnpj = normalizeCnpj(body.cnpj || existing?.cnpj);
    const login = normalizeCompanyLogin(body.login, cnpj);
    const profile = existing ? {} : companyEditableFields(body, { requireName: true });
    const prior = await storage.getCompanyRegistration(requestId, actorSub);
    if (prior && existing && prior.id !== existing.id) throw httpError(409, 'O identificador já foi usado em outro cadastro.', 'CADASTRO_IDENTIFICADOR_REUTILIZADO');
    if (!prior) {
      // Fail before reserving the company when a pre-existing Cognito login is known.
      // A timed-out attempt has a durable reservation, so it skips this preflight.
      const found = await accounts.inspect(login);
      if (found) throw httpError(409, 'Este login já está em uso. Escolha outro login para a empresa.', 'LOGIN_JA_UTILIZADO');
    }
    const data = {
      ...profile,
      cnpj, login,
      status: existing?.status || 'Ativa',
      acessoStatus: 'pendente',
      _accessRegistration: { requestId, startedBy: actorSub }
    };
    const reserved = await storage.reserveCompanyRegistration(data, {
      requestId, actorSub,
      ...(existing ? { empresaId: existing.id, expectedVersion: existing._version } : {})
    });
    return provision(reserved.item);
  }
  async function register(body, actorSub) {
    return prepare(body, actorSub);
  }
  async function resume(id, body, actorSub) {
    const item = await company(id);
    if (item._accessRegistration) {
      if ('cnpj' in body && normalizeCnpj(body.cnpj) !== normalizeCnpj(item.cnpj) || 'login' in body && normalizeCompanyLogin(body.login) !== item.login) {
        throw httpError(409, 'O CNPJ e o login do acesso já foram definidos. Retome o cadastro sem alterar sua identidade.', 'ACESSO_IDENTIDADE_IMUTAVEL');
      }
      return provision(item);
    }
    return prepare(body, actorSub, item);
  }
  async function edit(id, body, { expectedVersion } = {}) {
    const item = await company(id);
    if ('cnpj' in body && normalizeCnpj(body.cnpj) !== normalizeCnpj(item.cnpj) || 'login' in body && normalizeCompanyLogin(body.login) !== item.login) {
      throw httpError(409, 'CNPJ e login são definidos na criação do acesso. Use o cadastro de acesso da empresa para configurá-los.', 'ACESSO_IDENTIDADE_IMUTAVEL');
    }
    const fields = companyEditableFields(body);
    if (!Object.keys(fields).length) throw httpError(400, 'Informe os dados ou a logo que deseja atualizar.', 'EMPRESA_SEM_ALTERACOES');
    const updated = await storage.update('empresa', id, fields, { expectedVersion: expectedVersion ?? item._version });
    return publicCompany(updated);
  }
  return { register, resume, edit, company, publicCompany };
}
