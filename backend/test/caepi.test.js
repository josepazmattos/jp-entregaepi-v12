import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCA, normalizeDatabase, presentCA, consultarCA, buscarPorNome } from '../src/services/caepi.service.js';

test('CA aceita formatação usual, mas rejeita letras soltas, objetos e números inválidos', () => {
  assert.equal(normalizarCA('CA 036.500'), '36500');
  assert.equal(normalizarCA(365), '365');
  for (const value of ['000', '-365', 'x365', {}, [], null]) assert.equal(normalizarCA(value), '');
});

test('base em array e export legado items normalizam o mesmo certificado sem inventar procedência', () => {
  const raw = { ca: '00365', name: 'CAPACETE SINTÉTICO', manufacturer: 'FABRICANTE SINTÉTICO', validity: '09/01/2028', status: 'Válido' };
  const array = normalizeDatabase([raw]).get('365');
  const legacy = normalizeDatabase({ items: { '365': raw } }).get('365');
  assert.deepEqual(array, legacy);
  const response = presentCA(legacy, new Date('2026-10-07T00:00:00Z'));
  assert.equal(response.description, raw.name);
  assert.equal(response.status, 'Conferência necessária');
  assert.equal(response.verified, false);
  assert.equal(response.live, false);
  assert.equal(response.sourceUpdatedAt, null);
  assert.equal(response.reportedStatus, 'Válido');
});

test('registros demonstrativos são excluídos da consulta e de pesquisas', async () => {
  assert.equal(normalizeDatabase([{ ca: '777', name: 'Luva', manufacturer: 'Fabricante demonstrativo' }]).size, 0);
  const missing = await consultarCA('9999999999');
  assert.equal(missing.found, false);
  assert.match(missing.warning, /não comprova/);
});

test('cópia oficial continua identificada como cópia e não perde situação de cancelamento', () => {
  const db = normalizeDatabase({ sourceKind: 'official-snapshot', sourceUrl: 'https://caepi.trabalho.gov.br/base.txt', sourceUpdatedAt: '2026-10-01', items: [
    { ca: '70001', name: 'EPI SINTÉTICO', status: 'Válido', validity: '30/09/2026' },
    { ca: '70002', name: 'EPI SINTÉTICO', status: 'Cancelado', validity: '30/09/2026' }
  ] });
  const expired = presentCA(db.get('70001'), new Date('2026-10-07T00:00:00Z'));
  assert.equal(expired.status, 'Vencido na base consultada');
  assert.equal(expired.live, false);
  assert.equal(expired.verified, false);
  assert.equal(presentCA(db.get('70002'), new Date('2026-10-07T00:00:00Z')).status, 'Cancelado');
});

test('pesquisa e consulta recusam tipos inesperados com erro controlado', async () => {
  await assert.rejects(consultarCA('inválido'), error => error.status === 400);
  await assert.rejects(buscarPorNome({ q: 'teste' }), error => error.status === 400);
  assert.ok((await buscarPorNome('capacete')).every(item => item.live === false));
});
