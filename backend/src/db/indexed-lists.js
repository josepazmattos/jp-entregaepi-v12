import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const supported = new Set(['empresa', 'trabalhador', 'ficha', 'epi', 'auditoria']);
const failure = () => Object.assign(new Error('A consulta está temporariamente ocupada. Tente novamente.'), { status: 503, code: 'CONSULTA_OCUPADA' });

// The index contains only keys. Read current records strongly consistently from the
// primary table: stale/deleted index entries never expose old customer data.
// This reader is for display only. Transactions retain their original strong scan
// and revision checks; GSI propagation must never decide identity or uniqueness.
export function createIndexedLists({ client, tableName, entityIndex, companyIndex, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  async function readKeys(keys) {
    const records = [];
    for (let offset = 0; offset < keys.length; offset += 100) {
      let pending = { [tableName]: { Keys: keys.slice(offset, offset + 100), ConsistentRead: true } };
      for (let attempt = 0; Object.keys(pending).length; attempt++) {
        if (attempt >= 5) throw failure(); // Never silently return a partial list.
        if (attempt) await delay(30 * 2 ** (attempt - 1));
        const result = await client.send(new BatchGetCommand({ RequestItems: pending }));
        records.push(...(result.Responses?.[tableName] || []));
        pending = result.UnprocessedKeys || {};
        if (pending[tableName]?.Keys?.length === 0) delete pending[tableName];
      }
    }
    return records;
  }

  return async function indexedList(entity, empresaId = null, recentIds = []) {
    if (!supported.has(entity)) throw new Error('Unsupported display entity');
    if (!Array.isArray(recentIds) || recentIds.length > 100 || recentIds.some(id => typeof id !== 'string' || !id || id.length > 128)) {
      throw Object.assign(new Error('Identificadores de consulta inválidos.'), { status: 400, code: 'CONSULTA_INVALIDA' });
    }
    const scoped = empresaId != null;
    const keys = new Map(recentIds.map(id => [`${entity}#${id}`, { pk: `${entity}#${id}`, sk: 'META' }]));
    let cursor;
    do {
      const page = await client.send(new QueryCommand({
        TableName: tableName,
        IndexName: scoped ? companyIndex : entityIndex,
        KeyConditionExpression: scoped ? '#company = :company AND begins_with(#pk, :prefix)' : '#entity = :entity',
        ExpressionAttributeNames: scoped ? { '#company': 'empresaId', '#pk': 'pk' } : { '#entity': 'entity' },
        ExpressionAttributeValues: scoped ? { ':company': empresaId, ':prefix': `${entity}#` } : { ':entity': entity },
        Limit: 100,
        ...(cursor ? { ExclusiveStartKey: cursor } : {})
      }));
      for (const key of page.Items || []) if (key.sk === 'META' && typeof key.pk === 'string' && key.pk.startsWith(`${entity}#`)) keys.set(key.pk, { pk: key.pk, sk: key.sk });
      cursor = page.LastEvaluatedKey;
    } while (cursor && Object.keys(cursor).length);
    const records = await readKeys([...keys.values()]);
    return records.filter(item => item.entity === entity && (!scoped || item.empresaId === empresaId))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  };
}
