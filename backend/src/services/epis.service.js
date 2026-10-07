import { createHash } from 'node:crypto';
import { httpError } from '../middleware/auth.js';
import { textField } from '../routes/_helpers.js';
import { normalizarCA } from './caepi.service.js';

const compare = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const fold = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');

export function normalizeEquipment(body = {}) {
  if (body.semCA != null && typeof body.semCA !== 'boolean') throw httpError(400, 'A opção Sem CA deve ser verdadeira ou falsa.', 'TIPO_EQUIPAMENTO_INVALIDO');
  const tipo = body.tipo || (body.semCA === true ? 'sem_ca' : 'epi_ca');
  if (body.semCA != null && (body.semCA !== (tipo === 'sem_ca'))) throw httpError(400, 'As opções de tipo de equipamento são divergentes.', 'TIPO_EQUIPAMENTO_INVALIDO');
  if (!['epi_ca', 'sem_ca'].includes(tipo)) throw httpError(400, 'Selecione EPI com CA ou Equipamento sem CA.', 'TIPO_EQUIPAMENTO_INVALIDO');
  const ca = normalizarCA(body.ca);
  if (tipo === 'epi_ca' && !ca) throw httpError(400, 'Informe um número de CA válido ou escolha Equipamento sem CA.', 'CA_INVALIDO');
  if (tipo === 'sem_ca' && body.ca != null && String(body.ca).trim()) throw httpError(400, 'Equipamento sem CA deve ficar com o campo CA vazio.', 'CA_INCOMPATIVEL');
  const descricao = textField(body.descricao || body.description || body.name, { required: true, field: 'Descrição do equipamento', max: 2000 });
  return {
    tipo,
    semCA: tipo === 'sem_ca',
    catalogoCompartilhado: true,
    ca: tipo === 'sem_ca' ? '' : ca,
    descricao,
    name: descricao,
    fabricante: textField(body.fabricante || body.manufacturer, { field: 'Fabricante', max: 500 }),
    modelo: textField(body.modelo, { field: 'Modelo', max: 300 }),
    tamanho: textField(body.tamanho, { field: 'Tamanho', max: 100 }),
    // This field refers to CA validity; a non-certified item must not inherit it from a previous lookup.
    validade: tipo === 'sem_ca' ? '' : textField(body.validade || body.validity, { field: 'Validade do CA', max: 100 }),
    situacao: tipo === 'sem_ca' ? 'Sem CA informado' : textField(body.situacao || body.status, { field: 'Situação', max: 300 }) || 'Conferência necessária',
    origemCadastro: 'informado_pelo_usuario'
  };
}

export function equipmentKey(item) {
  const ca = normalizarCA(item.ca);
  const tipo = item.tipo === 'sem_ca' || (!ca && item.tipo !== 'epi_ca') ? 'sem_ca' : 'epi_ca';
  const identity = tipo === 'sem_ca'
    ? [tipo, fold(item.descricao || item.description || item.name), fold(item.fabricante || item.manufacturer), fold(item.modelo), fold(item.tamanho)]
    : [tipo, ca, fold(item.modelo), fold(item.tamanho)];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function publicEquipment(item) {
  const ca = normalizarCA(item.ca);
  const tipo = item.tipo === 'sem_ca' || !ca ? 'sem_ca' : 'epi_ca';
  const descricao = textField(item.descricao || item.description || item.name, { max: 2000 });
  return {
    id: item.id,
    tipo,
    semCA: tipo === 'sem_ca',
    catalogoCompartilhado: true,
    ca: tipo === 'sem_ca' ? '' : ca,
    descricao,
    name: descricao,
    fabricante: textField(item.fabricante || item.manufacturer, { max: 1000 }),
    modelo: textField(item.modelo, { max: 1000 }),
    tamanho: textField(item.tamanho, { max: 1000 }),
    validade: tipo === 'sem_ca' ? '' : textField(item.validade || item.validity, { max: 1000 }),
    situacao: tipo === 'sem_ca' ? 'Sem CA informado' : textField(item.situacao || item.status, { max: 1000 }) || 'Conferência necessária'
  };
}

export function listEquipmentCatalog(records) {
  const unique = new Map();
  // Retain original IDs and historical records. Choose a stable representative for legacy duplicates.
  const stable = [...records].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  for (const item of stable) {
    const key = equipmentKey(item);
    if (!unique.has(key)) unique.set(key, publicEquipment(item));
  }
  return [...unique.values()].sort((a, b) => compare.compare(a.descricao, b.descricao) || compare.compare(a.modelo, b.modelo) || compare.compare(a.tamanho, b.tamanho) || compare.compare(a.ca, b.ca));
}

export function findEquipment(records, data) {
  const key = equipmentKey(data);
  return records.filter(item => equipmentKey(item) === key)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)))[0] || null;
}
