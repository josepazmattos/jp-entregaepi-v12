import { existsSync } from 'node:fs';
import { createSnapshotReader } from './caepi.reader.js';

export const CAEPI_CONSULTA_URL = 'https://caepi.trabalho.gov.br/internet/ConsultaCAInternet.aspx';
const shardManifest = new URL('../data/caepi/manifest.json', import.meta.url);
const databasePath = process.env.CAEPI_DB_PATH || (existsSync(shardManifest) ? shardManifest : new URL('../data/caepi-db.json', import.meta.url));

export function normalizarCA(value) {
  if (!['string', 'number'].includes(typeof value)) return '';
  const text = String(value).trim().replace(/^CA\s*[:\-]?\s*/i, '');
  if (!/^[\d.\s]+$/.test(text)) return '';
  const digits = text.replace(/[.\s]/g, '').replace(/^0+/, '');
  return /^\d{1,10}$/.test(digits) ? digits : '';
}

function folded(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function textValue(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function normalizeDate(value) {
  const text = textValue(value);
  const parts = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : text.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? '' : iso;
}

export function normalizeDatabase(database) {
  const metadata = !Array.isArray(database) && database && typeof database === 'object' ? database : {};
  const rawItems = Array.isArray(database) ? database : metadata.items;
  const entries = Array.isArray(rawItems) ? rawItems.map(item => [item?.ca, item])
    : rawItems && typeof rawItems === 'object' ? Object.entries(rawItems) : [];
  const items = new Map();
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const ca = normalizarCA(value.ca ?? key);
    if (!ca) continue;
    // Sample records must never autocomplete an actual safety-equipment register.
    const provenance = `${value.obs || ''} ${value.source || ''} ${value.manufacturer || value.fabricante || ''}`;
    const sourceUrl = textValue(value.sourceUrl || metadata.sourceUrl);
    const sourceUpdatedAt = textValue(value.sourceUpdatedAt || metadata.sourceUpdatedAt || metadata.updatedAt);
    const downloadedAt = textValue(value.downloadedAt || metadata.downloadedAt);
    const officialSnapshot = (value.sourceKind || metadata.sourceKind) === 'official-snapshot'
      && /^https:\/\/(?:caepi\.trabalho\.gov\.br|caepi\.mte\.gov\.br|www\.gov\.br)\//.test(sourceUrl)
      && Boolean(normalizeDate(downloadedAt.slice(0, 10)) || normalizeDate(sourceUpdatedAt.slice(0, 10)));
    if (!officialSnapshot && /demonstrativ|fictici|exemplo|\bsample\b|\bdemo\b/i.test(folded(provenance))) continue;
    const originalStatus = textValue(value.status || value.situacao);
    const validity = textValue(value.validity || value.validade);
    const description = textValue(value.description || value.descricao || value.name || value.nome);
    items.set(ca, {
      ca,
      name: textValue(value.name || value.nome) || description,
      description,
      manufacturer: textValue(value.manufacturer || value.fabricante),
      validity,
      reportedStatus: originalStatus,
      reportedValidity: validity,
      status: officialSnapshot ? originalStatus || 'Conferir situação no MTE' : 'Conferência necessária',
      source: officialSnapshot ? 'Cópia da base CAEPI/MTE' : 'Base local complementar não verificada',
      sourceKind: officialSnapshot ? 'official-snapshot' : 'local-complementar',
      sourceUrl: officialSnapshot ? sourceUrl : null,
      sourceUpdatedAt: officialSnapshot && normalizeDate(sourceUpdatedAt.slice(0, 10)) ? sourceUpdatedAt : null,
      downloadedAt: officialSnapshot && normalizeDate(downloadedAt.slice(0, 10)) ? downloadedAt : null,
      officialSnapshot,
      ambiguous: value.ambiguous === true,
      variantCount: Number.isSafeInteger(value.variantCount) ? value.variantCount : null,
      sourceStatuses: Array.isArray(value.sourceStatuses) ? value.sourceStatuses.map(textValue) : [],
      warning: textValue(value.warning),
      obs: textValue(value.obs),
      consultaOficialUrl: CAEPI_CONSULTA_URL
    });
  }
  return items;
}

const database = createSnapshotReader({ filePath: databasePath, normalize: normalizeDatabase, cacheSize: 4 });

export function presentCA(item, now = new Date()) {
  const validityDate = normalizeDate(item.validity);
  const expired = validityDate ? validityDate < now.toISOString().slice(0, 10) : null;
  return {
    ...item,
    found: !item.ambiguous,
    // Reading a packaged file is not an online check of the certificate.
    live: false,
    verified: false,
    requiresOfficialCheck: true,
    requiresOfficialConfirmation: true,
    autofillAllowed: !item.ambiguous,
    consultedAt: now.toISOString(),
    validityExpired: expired,
    status: item.officialSnapshot && expired && !/cancel|suspens|revog|inativ/i.test(folded(item.status)) ? 'Vencido na base consultada' : item.status,
    warning: item.officialSnapshot
      ? `Cópia da base oficial ${item.downloadedAt ? 'obtida em ' + item.downloadedAt.slice(0, 10) : 'com referência em ' + item.sourceUpdatedAt.slice(0, 10)}. Confirme a situação atual no CAEPI/MTE.`
      : 'Dados locais sem confirmação oficial. Confirme fabricante, descrição e validade no CAEPI/MTE antes de salvar.',
    ...(item.ambiguous ? {
      name: '', description: '', manufacturer: '', validity: '', status: 'Conferir no MTE',
      warning: item.warning || 'A base oficial contém registros divergentes para este CA. Confira no portal do MTE antes do preenchimento.'
    } : {})
  };
}

export function caepiStatus() {
  return {
    ...database.status(),
    consultaOficialUrl: CAEPI_CONSULTA_URL
  };
}

export async function consultarCA(value) {
  const ca = normalizarCA(value);
  if (!ca) {
    const error = new Error('Informe um número de CA válido.');
    error.status = 400;
    error.code = 'CA_INVALIDO';
    throw error;
  }
  const item = database.get(ca);
  const metadata = database.status();
  return item ? presentCA(item) : {
    found: false,
    ca,
    name: '',
    description: '',
    status: 'Não localizado na base disponível',
    validity: '',
    manufacturer: '',
    live: false,
    verified: false,
    requiresOfficialCheck: true,
    requiresOfficialConfirmation: true,
    autofillAllowed: false,
    officialSnapshot: metadata.sourceKind === 'official-snapshot',
    sourceKind: metadata.sourceKind,
    sourceUpdatedAt: metadata.sourceUpdatedAt,
    downloadedAt: metadata.downloadedAt,
    consultaOficialUrl: CAEPI_CONSULTA_URL,
    warning: 'A ausência na base disponível não comprova que o CA inexiste. Consulte o CAEPI/MTE.'
  };
}

export async function buscarPorNome(q) {
  if (typeof q !== 'string') {
    const error = new Error('Informe um único texto de pesquisa.');
    error.status = 400;
    throw error;
  }
  const term = folded(q.trim().slice(0, 120));
  return database.search(item => !term || folded(`${item.ca} ${item.name} ${item.description} ${item.manufacturer}`).includes(term), term ? 50 : 20)
    .map(item => presentCA(item));
}
