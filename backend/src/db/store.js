import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, paginateScan } from '@aws-sdk/lib-dynamodb';

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
  return { status, probe, list, get, create, update, remove };
}

const tableName = (process.env.TABLE_NAME || '').trim();
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'sa-east-1';
const client = tableName ? DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } }) : null;
const store = createStore({
  tableName,
  client,
  allowMemory: process.env.DATA_MODE === 'memory' && process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME
});
export const { list, create, get, update, remove, status: storageStatus, probe: probeStorage } = store;
