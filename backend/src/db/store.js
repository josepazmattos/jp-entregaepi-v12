import { randomUUID, createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, TransactWriteCommand, paginateScan } from '@aws-sdk/lib-dynamodb';

function storageError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function recordKey(entity, id) {
  return { pk: `${entity}#${id}`, sk: 'META' };
}

function validateItemSize(item) {
  // Keep room below DynamoDB's per-item limit for attribute names and encoding.
  if (Buffer.byteLength(JSON.stringify(item), 'utf8') > 300 * 1024) {
    throw storageError('Registro muito grande. Reduza a imagem anexada.', 'REGISTRO_MUITO_GRANDE', 413);
  }
}

function publicData(data = {}) {
  const { id, pk, sk, entity, createdAt, updatedAt, _version, ...values } = data;
  return values;
}

function ordered(items) {
  return items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}

function transactionName(value, field, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw storageError(`${field} inválido.`, 'TRANSACAO_INVALIDA', 400);
  return value;
}

export function createStore({ tableName = '', client = null, allowMemory = false } = {}) {
  const memory = new Map();
  const status = () => ({ mode: tableName && client ? 'dynamodb' : allowMemory && !tableName ? 'memory' : 'unconfigured', durable: Boolean(tableName && client), configured: Boolean(tableName && client) || (allowMemory && !tableName) });
  function assertReady() {
    if (!status().configured) throw storageError('Persistência indisponível: configure TABLE_NAME antes de usar a API.', 'PERSISTENCIA_NAO_CONFIGURADA', 503);
  }
  function revisionCondition(previous) {
    const condition = { ConditionExpression: 'attribute_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } };
    if (previous._version != null) {
      condition.ConditionExpression += ' AND #version = :version';
      condition.ExpressionAttributeNames['#version'] = '_version';
      condition.ExpressionAttributeValues = { ':version': previous._version };
    } else if (previous.updatedAt) {
      condition.ConditionExpression += ' AND #updatedAt = :updatedAt AND attribute_not_exists(#version)';
      condition.ExpressionAttributeNames['#updatedAt'] = 'updatedAt';
      condition.ExpressionAttributeNames['#version'] = '_version';
      condition.ExpressionAttributeValues = { ':updatedAt': previous.updatedAt };
    } else {
      condition.ConditionExpression += ' AND attribute_not_exists(#version)';
      condition.ExpressionAttributeNames['#version'] = '_version';
    }
    return condition;
  }
  function checkExpected(previous, options = {}) {
    if ((options.expectedVersion != null && previous._version !== options.expectedVersion)
      || (options.expectedUpdatedAt && previous.updatedAt !== options.expectedUpdatedAt)) {
      throw storageError('O registro foi alterado por outro usuário. Atualize a tela.', 'REGISTRO_ALTERADO');
    }
  }
  async function send(command) {
    try { return await client.send(command); }
    catch (error) {
      if (error.name === 'ConditionalCheckFailedException') throw storageError('O registro foi alterado por outro usuário. Atualize a tela.', 'REGISTRO_ALTERADO');
      throw error;
    }
  }
  async function list(entity, empresaId = null) {
    assertReady();
    if (!tableName) return ordered([...memory.values()].filter(item => item.entity === entity && (empresaId == null || item.empresaId === empresaId)).map(item => structuredClone(item)));
    const names = { '#entity': 'entity' };
    const values = { ':entity': entity };
    let filter = '#entity = :entity';
    if (empresaId != null) {
      names['#empresaId'] = 'empresaId';
      values[':empresaId'] = empresaId;
      filter += ' AND #empresaId = :empresaId';
    }
    const items = [];
    // A filtered page may be empty while LastEvaluatedKey still points to more records.
    for await (const page of paginateScan({ client }, {
      TableName: tableName,
      FilterExpression: filter,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConsistentRead: true
    })) items.push(...(page.Items || []));
    return ordered(items);
  }
  async function get(entity, id) {
    assertReady();
    if (!id) return null;
    if (!tableName) return structuredClone(memory.get(recordKey(entity, id).pk) || null);
    const result = await send(new GetCommand({ TableName: tableName, Key: recordKey(entity, id), ConsistentRead: true }));
    return result.Item || null;
  }
  async function create(entity, data = {}) {
    assertReady();
    const id = randomUUID();
    const now = new Date().toISOString();
    const item = { ...publicData(data), id, entity, ...recordKey(entity, id), createdAt: now, updatedAt: now, _version: 1 };
    validateItemSize(item);
    if (!tableName) memory.set(item.pk, structuredClone(item));
    else await send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } }));
    return structuredClone(item);
  }
  async function update(entity, id, changes, options = {}) {
    assertReady();
    const previous = await get(entity, id);
    if (!previous) throw storageError('Registro não encontrado.', 'REGISTRO_NAO_ENCONTRADO', 404);
    checkExpected(previous, options);
    if (changes.empresaId != null && changes.empresaId !== previous.empresaId) throw storageError('O vínculo com a empresa não pode ser alterado.', 'EMPRESA_DIVERGENTE', 403);
    const item = { ...previous, ...publicData(changes), id: previous.id, entity, ...recordKey(entity, id), createdAt: previous.createdAt, updatedAt: new Date().toISOString(), _version: (previous._version || 0) + 1 };
    validateItemSize(item);
    if (!tableName) memory.set(item.pk, structuredClone(item));
    else await send(new PutCommand({ TableName: tableName, Item: item, ...revisionCondition(previous) }));
    return structuredClone(item);
  }
  async function remove(entity, id, options = {}) {
    assertReady();
    const previous = await get(entity, id);
    if (!previous) return false;
    checkExpected(previous, options);
    if (!tableName) return memory.delete(previous.pk);
    await send(new DeleteCommand({ TableName: tableName, Key: recordKey(entity, id), ...revisionCondition(previous) }));
    return true;
  }

  async function readScope(scope) {
    transactionName(scope, 'Escopo');
    const item = await get('__scope', digest(scope));
    return item?.revision || 0;
  }

  async function listWithRevision(entity, empresaId, scope) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const before = await readScope(scope);
      const items = await list(entity, empresaId);
      const revision = await readScope(scope);
      if (before === revision) return { items, revision };
    }
    throw storageError('Os dados foram alterados durante a consulta. Atualize e tente novamente.', 'REGISTRO_ALTERADO');
  }

  function receiptId(scope, mutationId) {
    transactionName(scope, 'Escopo');
    transactionName(mutationId, 'Identificador da operação', 256);
    return digest(`${scope}\0${mutationId}`);
  }

  async function getReceipt(scope, mutationId) {
    return get('__receipt', receiptId(scope, mutationId));
  }

  async function transact({ scope, expectedRevision, mutationId, operations, result = null }) {
    assertReady();
    const receiptKey = receiptId(scope, mutationId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Array.isArray(operations) || !operations.length || operations.length > 90) {
      throw storageError('Lote inválido. Envie até 90 alterações por transação.', 'TRANSACAO_INVALIDA', 400);
    }
    const requestHash = digest(JSON.stringify(canonical({ scope, expectedRevision, operations, result })));
    const replay = receipt => {
      if (receipt.requestHash !== requestHash) throw storageError('Esta operação já foi usada com outros dados.', 'IDEMPOTENCIA_DIVERGENTE');
      return { revision: receipt.revision, result: structuredClone(receipt.result), replayed: true };
    };
    const previousReceipt = await getReceipt(scope, mutationId);
    if (previousReceipt) return replay(previousReceipt);
    if (await readScope(scope) !== expectedRevision) throw storageError('Os dados foram alterados por outra operação. Gere uma nova prévia.', 'REGISTRO_ALTERADO');
    const now = new Date().toISOString();
    const keys = new Set();
    const prepared = await Promise.all(operations.map(async operation => {
      const { type, entity, id, data = {}, expectedVersion, expectedUpdatedAt } = operation;
      transactionName(entity, 'Tipo de registro', 80);
      transactionName(id, 'Identificador do registro', 256);
      if (!['create', 'update', 'delete'].includes(type) || !data || typeof data !== 'object' || Array.isArray(data)) throw storageError('Alteração inválida.', 'TRANSACAO_INVALIDA', 400);
      const key = recordKey(entity, id);
      if (keys.has(key.pk)) throw storageError('O lote contém o mesmo registro mais de uma vez.', 'TRANSACAO_INVALIDA', 400);
      keys.add(key.pk);
      if (type === 'create') {
        const item = { ...publicData(data), id, entity, ...key, createdAt: now, updatedAt: now, _version: 1 };
        validateItemSize(item);
        return { type, key, item, previous: null, command: { Put: { TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } } } };
      }
      const previous = await get(entity, id);
      if (!previous) throw storageError('Registro não encontrado durante a sincronização.', 'REGISTRO_NAO_ENCONTRADO', 404);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || (previous._version || 1) !== expectedVersion) throw storageError('O registro foi alterado por outro usuário. Gere uma nova prévia.', 'REGISTRO_ALTERADO');
      if (expectedUpdatedAt && previous.updatedAt !== expectedUpdatedAt) throw storageError('O registro foi alterado por outro usuário. Gere uma nova prévia.', 'REGISTRO_ALTERADO');
      if (type === 'delete') return { type, key, previous, command: { Delete: { TableName: tableName, Key: key, ...revisionCondition(previous) } } };
      if (data.empresaId != null && data.empresaId !== previous.empresaId) throw storageError('O vínculo com a empresa não pode ser alterado.', 'EMPRESA_DIVERGENTE', 403);
      const item = { ...previous, ...publicData(data), id, entity, ...key, createdAt: previous.createdAt, updatedAt: now, _version: (previous._version || 1) + 1 };
      validateItemSize(item);
      return { type, key, previous, item, command: { Put: { TableName: tableName, Item: item, ...revisionCondition(previous) } } };
    }));
    const scopeId = digest(scope);
    const scopeItem = { ...recordKey('__scope', scopeId), entity: '__scope', id: scopeId, scope, revision: expectedRevision + 1, updatedAt: now };
    const receipt = { ...recordKey('__receipt', receiptKey), entity: '__receipt', id: receiptKey, scope, mutationId, requestHash, revision: expectedRevision + 1, result: structuredClone(result), createdAt: now };
    validateItemSize(receipt);
    if (keys.has(scopeItem.pk) || keys.has(receipt.pk)) throw storageError('O lote contém chave reservada.', 'TRANSACAO_INVALIDA', 400);
    const scopeCondition = expectedRevision === 0
      ? { ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } }
      : { ConditionExpression: '#revision = :revision', ExpressionAttributeNames: { '#revision': 'revision' }, ExpressionAttributeValues: { ':revision': expectedRevision } };
    const TransactItems = [...prepared.map(item => item.command),
      { Put: { TableName: tableName, Item: scopeItem, ...scopeCondition } },
      { Put: { TableName: tableName, Item: receipt, ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } } }
    ];
    if (Buffer.byteLength(JSON.stringify(TransactItems), 'utf8') > 3500 * 1024) throw storageError('Lote muito grande. Divida a planilha.', 'REGISTRO_MUITO_GRANDE', 413);
    if (!tableName) {
      // Check every condition immediately before the synchronous memory commit.
      const currentReceipt = memory.get(receipt.pk);
      if (currentReceipt) return replay(currentReceipt);
      if ((memory.get(scopeItem.pk)?.revision || 0) !== expectedRevision) throw storageError('Os dados foram alterados por outra operação.', 'REGISTRO_ALTERADO');
      for (const entry of prepared) {
        const current = memory.get(entry.key.pk);
        if (entry.type === 'create' ? Boolean(current) : !current || (current._version || 1) !== (entry.previous._version || 1) || current.updatedAt !== entry.previous.updatedAt) throw storageError('O registro foi alterado por outro usuário.', 'REGISTRO_ALTERADO');
      }
      for (const entry of prepared) {
        if (entry.type === 'delete') memory.delete(entry.key.pk);
        else memory.set(entry.key.pk, structuredClone(entry.item));
      }
      memory.set(scopeItem.pk, structuredClone(scopeItem));
      memory.set(receipt.pk, structuredClone(receipt));
    } else {
      try { await client.send(new TransactWriteCommand({ TransactItems })); }
      catch (error) {
        // A timeout can arrive after AWS committed the complete transaction.
        const committed = await getReceipt(scope, mutationId);
        if (committed) return replay(committed);
        if (error.name === 'ConditionalCheckFailedException'
          || (error.name === 'TransactionCanceledException' && error.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed'))) {
          throw storageError('Os dados foram alterados por outra operação. Gere uma nova prévia.', 'REGISTRO_ALTERADO');
        }
        if (error.name === 'TransactionConflictException'
          || (error.name === 'TransactionCanceledException' && error.CancellationReasons?.some(reason => reason.Code === 'TransactionConflict'))) {
          // Contention does not prove that the competing transaction committed.
          // Keep the caller's preview available to resume with the same receipt.
          throw storageError('Outra operação está em andamento. Aguarde alguns instantes e retome a sincronização.', 'TRANSACAO_OCUPADA', 503);
        }
        throw error;
      }
    }
    return { revision: expectedRevision + 1, result: structuredClone(result), replayed: false };
  }

  function companyRegistrationId(requestId, actorSub) {
    transactionName(requestId, 'Identificador da solicitação', 128);
    transactionName(actorSub, 'Administrador', 256);
    return digest(`${actorSub}\0${requestId}`);
  }

  async function getCompanyRegistration(requestId, actorSub) {
    const record = await get('__company_registration', companyRegistrationId(requestId, actorSub));
    return record ? get('empresa', record.empresaId) : null;
  }

  async function reserveCompanyRegistration(data, { requestId, actorSub, empresaId = null, expectedVersion } = {}) {
    const registrationId = companyRegistrationId(requestId, actorSub);
    const normalizedCnpj = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cnpj = normalizedCnpj(data.cnpj);
    const login = String(data.login || '').trim().toLowerCase();
    if (!cnpj || !login) throw storageError('Informe CNPJ e login para criar o acesso.', 'CADASTRO_INVALIDO', 400);
    const fields = ['nome', 'cnpj', 'login', 'localidade', 'uf', 'responsavel', 'email', 'telefone', 'logoDataUrl'];
    const immutableRequest = Object.fromEntries(fields.map(key => [key, key === 'cnpj' ? cnpj : key === 'login' ? login : data[key] || '']));
    const requestHash = digest(JSON.stringify(canonical({ empresaId, data: immutableRequest })));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const prior = await get('__company_registration', registrationId);
      if (prior) {
        if (prior.requestHash !== requestHash) throw storageError('A solicitação já foi usada com outros dados. Atualize o cadastro.', 'IDEMPOTENCIA_DIVERGENTE');
        const item = await get('empresa', prior.empresaId);
        if (!item) throw storageError('A reserva do cadastro está inconsistente. Solicite suporte.', 'CADASTRO_INCONSISTENTE', 409);
        return { item, created: false };
      }
      const { items, revision } = await listWithRevision('empresa', null, 'company-registrations');
      if (items.some(item => item.id !== empresaId && normalizedCnpj(item.cnpj) === cnpj)) throw storageError('Este CNPJ já está cadastrado.', 'CNPJ_DUPLICADO');
      if (items.some(item => item.id !== empresaId && String(item.login || '').toLowerCase() === login)) throw storageError('Este login já está cadastrado.', 'LOGIN_DUPLICADO');
      const existing = empresaId ? await get('empresa', empresaId) : null;
      if (empresaId && !existing) throw storageError('Empresa não encontrada.', 'REGISTRO_NAO_ENCONTRADO', 404);
      if (existing && (existing._accessRegistration || existing.cognitoSub || existing.login)) throw storageError('Esta empresa já possui uma reserva de acesso. Retome o cadastro existente.', 'ACESSO_JA_RESERVADO');
      if (existing) checkExpected(existing, { expectedVersion });
      const id = existing?.id || randomUUID();
      const company = { ...publicData(data), cnpj, login, criadoPor: existing?.criadoPor || actorSub,
        _accessRegistration: { requestId, startedBy: actorSub }, acessoStatus: 'pendente' };
      const operations = [
        { type: existing ? 'update' : 'create', entity: 'empresa', id, data: company, ...(existing ? { expectedVersion: existing._version || 1 } : {}) },
        { type: 'create', entity: '__company_cnpj', id: cnpj, data: { empresaId: id } },
        { type: 'create', entity: '__company_login', id: digest(login), data: { empresaId: id } },
        { type: 'create', entity: '__company_registration', id: registrationId, data: { empresaId: id, requestHash } }
      ];
      try {
        await transact({ scope: 'company-registrations', expectedRevision: revision, mutationId: `registration-${registrationId}`, operations, result: { empresaId: id } });
        return { item: await get('empresa', id), created: !existing };
      } catch (error) {
        const committed = await get('__company_registration', registrationId);
        if (committed) {
          if (committed.requestHash !== requestHash) throw storageError('A solicitação já foi usada com outros dados. Atualize o cadastro.', 'IDEMPOTENCIA_DIVERGENTE');
          const item = await get('empresa', committed.empresaId);
          if (item) return { item, created: false };
        }
        if (error.code !== 'REGISTRO_ALTERADO' || attempt === 3) throw error;
      }
    }
  }
  async function probe() {
    const state = status();
    if (!state.configured) return { ...state, ready: false };
    if (!tableName) return { ...state, ready: true };
    try {
      // Read an internal, non-business key. Readiness never lists or writes user records.
      await send(new GetCommand({ TableName: tableName, Key: recordKey('__health__', 'readiness'), ConsistentRead: true }));
      return { ...state, ready: true };
    } catch {
      return { ...state, ready: false };
    }
  }
  return { status, probe, list, get, create, update, remove, readScope, listWithRevision, getReceipt, transact, getCompanyRegistration, reserveCompanyRegistration };
}

const tableName = (process.env.TABLE_NAME || '').trim();
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'sa-east-1';
const client = tableName ? DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } }) : null;
const store = createStore({
  tableName,
  client,
  allowMemory: process.env.DATA_MODE === 'memory' && process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME
});
export const { list, create, get, update, remove, readScope, listWithRevision, getReceipt, transact, getCompanyRegistration, reserveCompanyRegistration, status: storageStatus, probe: probeStorage } = store;
