import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEquipment, equipmentKey, publicEquipment, listEquipmentCatalog, findEquipment } from '../src/services/epis.service.js';

const technical = { ca: '12345', descricao: 'EQUIPAMENTO SINTÉTICO', fabricante: 'FABRICANTE SINTÉTICO', modelo: 'Modelo A', tamanho: 'M' };

test('catálogo comum remove empresa, autoria, observações privadas e metadados de persistência', () => {
  const item = { ...technical, id: 'legacy-A', empresaId: 'private-company', criadoPor: 'private-user', observacoes: 'private-note', lote: 'private-lot', pk: 'epi#legacy-A', _version: 3, createdAt: '2026-01-01' };
  const visible = publicEquipment(item);
  assert.equal(visible.id, item.id);
  assert.equal(visible.catalogoCompartilhado, true);
  assert.equal(visible.descricao, item.descricao);
  for (const key of ['empresaId', 'criadoPor', 'observacoes', 'lote', 'pk', 'sk', 'entity', '_version', 'createdAt', 'updatedAt']) assert.equal(key in visible, false);
  assert.equal(JSON.stringify(visible).includes('private-'), false);
});

test('deduplicação usa CA/modelo/tamanho normalizados preservando ID legado estável e diferenças técnicas', () => {
  const a = { ...technical, id: 'A', empresaId: 'company-A', createdAt: '2026-01-01' };
  const b = { ...technical, ca: 'CA 12.345', modelo: ' modelo   a ', tamanho: 'm', id: 'B', empresaId: 'company-B', createdAt: '2026-02-01' };
  const c = { ...technical, id: 'C', tamanho: 'G' };
  assert.equal(equipmentKey(a), equipmentKey(b));
  assert.notEqual(equipmentKey(a), equipmentKey(c));
  assert.equal(findEquipment([b, a], technical).id, 'A');
  assert.deepEqual(listEquipmentCatalog([b, a, c]).map(item => item.id), ['C', 'A']);
  assert.equal(a.empresaId, 'company-A');
  assert.equal(b.id, 'B');
});

test('equipamento sem CA é explícito, exige descrição e não inventa CA nem validade de certificado', () => {
  assert.throws(() => normalizeEquipment({ descricao: 'SEM NÚMERO' }), error => error.code === 'CA_INVALIDO');
  assert.throws(() => normalizeEquipment({ tipo: 'sem_ca' }), error => error.code === 'CAMPO_OBRIGATORIO');
  assert.throws(() => normalizeEquipment({ tipo: 'sem_ca', ca: '12345', descricao: 'SEM CA' }), error => error.code === 'CA_INCOMPATIVEL');
  const item = normalizeEquipment({ tipo: 'sem_ca', descricao: 'BOLSA DE FERRAMENTAS', validade: '2030-01-01', situacao: 'Aprovado', fabricante: 'SINTÉTICO' });
  assert.equal(item.ca, '');
  assert.equal(item.validade, '');
  assert.equal(item.situacao, 'Sem CA informado');
  assert.equal(item.tipo, 'sem_ca');
  assert.notEqual(equipmentKey(item), equipmentKey({ ...item, descricao: 'CAIXA DE FERRAMENTAS' }));
  const visible = publicEquipment({ ...item, id: 'shared-item' });
  assert.equal(visible.tipo, 'sem_ca');
  assert.equal(visible.ca, '');
});
