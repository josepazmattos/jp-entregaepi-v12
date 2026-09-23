import { randomUUID } from 'crypto';

const memory = new Map();

function key(entity, id) {
  return `${entity}#${id}`;
}

export async function list(entity, empresaId = null) {
  return [...memory.values()].filter(x => x.entity === entity && (!empresaId || x.empresaId === empresaId));
}

export async function create(entity, data) {
  const now = new Date().toISOString();
  const id = data.id || randomUUID();
  const item = {
    ...data,
    id,
    entity,
    pk: key(entity, id),
    createdAt: data.createdAt || now,
    updatedAt: now
  };
  memory.set(item.pk, item);
  return item;
}

export async function get(entity, id) {
  return memory.get(key(entity, id)) || null;
}

export async function remove(entity, id) {
  return memory.delete(key(entity, id));
}
