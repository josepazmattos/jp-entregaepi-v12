import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
// Only immutable business content. Certification, cancellation and transport metadata
// must not change what the worker acknowledged.
export function documentContent(ficha) {
  const fields = ['id','numero','empresaId','trabalhadorId','trabalhadorNome','empresaSnapshot','trabalhadorSnapshot','modeloFicha','itens','tipo','data','datasMovimentacao','criadoPor','createdAt'];
  return canonical(Object.fromEntries(fields.filter(key => ficha[key] !== undefined).map(key => [key, ficha[key]])));
}
export const documentHash = ficha => sha256(JSON.stringify(documentContent(ficha)));
