import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { httpError } from '../middleware/auth.js';
import { WORKER_COLUMNS, WORKER_IMPORT_LIMIT } from './trabalhadores.service.js';

export const XLSX_MAX_BYTES = 512 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_SHEET_ROWS = 2000;
const MAX_SHEET_COLUMNS = 40;
const invalid = message => httpError(400, message, 'PLANILHA_INVALIDA');
const normalizeHeader = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = new Map(WORKER_COLUMNS.flatMap(column => [[normalizeHeader(column.key), column], [normalizeHeader(column.label), column]]));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function decodeXlsx(base64, name) {
  if (typeof name !== 'string' || name.length > 180 || !/\.xlsx$/i.test(name.trim()) || /[\u0000-\u001F]/.test(name)) throw invalid('Envie o modelo no formato .xlsx.');
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(XLSX_MAX_BYTES / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw invalid('Arquivo ausente, inválido ou acima de 512 KB.');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > XLSX_MAX_BYTES || bytes.toString('base64') !== base64) throw invalid('Arquivo inválido ou acima de 512 KB.');
  validateXlsxArchive(bytes);
  return bytes;
}

export function validateXlsxArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > XLSX_MAX_BYTES) throw invalid('Arquivo XLSX inválido ou acima de 512 KB.');
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) {
    if (bytes.readUInt32LE(pos) === 0x06054b50 && pos + 22 + bytes.readUInt16LE(pos + 20) === bytes.length) { end = pos; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw invalid('Arquivo XLSX incompleto ou formato não suportado.');
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (!count || count > MAX_ZIP_ENTRIES || bytes.readUInt16LE(end + 8) !== count || directoryOffset + directorySize !== end) throw invalid('A estrutura da planilha excede os limites de importação.');
  let pos = directoryOffset;
  let expanded = 0;
  const names = new Set();
  const spans = [];
  for (let entry = 0; entry < count; entry++) {
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) throw invalid('Estrutura XLSX inválida.');
    const flags = bytes.readUInt16LE(pos + 8);
    const method = bytes.readUInt16LE(pos + 10);
    const crc = bytes.readUInt32LE(pos + 16);
    const compressedSize = bytes.readUInt32LE(pos + 20);
    const expandedSize = bytes.readUInt32LE(pos + 24);
    const nameSize = bytes.readUInt16LE(pos + 28);
    const extraSize = bytes.readUInt16LE(pos + 30);
    const commentSize = bytes.readUInt16LE(pos + 32);
    const disk = bytes.readUInt16LE(pos + 34);
    const offset = bytes.readUInt32LE(pos + 42);
    const next = pos + 46 + nameSize + extraSize + commentSize;
    if (next > end || !nameSize || disk !== 0 || flags & 1 || ![0, 8].includes(method) || expandedSize === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff) throw invalid('Planilha criptografada ou estrutura XLSX não suportada.');
    const name = bytes.subarray(pos + 46, pos + 46 + nameSize).toString('utf8');
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || names.has(name) || /[\u0000-\u001F]/.test(name)) throw invalid('Arquivo contém entradas XLSX inválidas ou duplicadas.');
    if (/\.(?:bin|exe|dll|js|vbs)$/i.test(name) || /^xl\/(?:externalLinks|activeX|embeddings)\//i.test(name)) throw invalid('Envie uma planilha .xlsx sem macros, objetos incorporados ou vínculos externos de pasta de trabalho.');
    names.add(name);
    expanded += expandedSize;
    if (expanded > MAX_EXPANDED_BYTES || expandedSize > 4 * 1024 * 1024) throw invalid('Planilha muito grande após descompactação. Divida a relação em arquivos menores.');
    if (offset + 30 > directoryOffset || bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) throw invalid('Entrada XLSX inconsistente.');
    const localNameSize = bytes.readUInt16LE(offset + 26);
    const localExtraSize = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameSize + localExtraSize;
    if (start + compressedSize > directoryOffset || bytes.subarray(offset + 30, offset + 30 + localNameSize).toString('utf8') !== name) throw invalid('Entrada XLSX incompleta.');
    if (!(flags & 8) && (bytes.readUInt32LE(offset + 14) !== crc || bytes.readUInt32LE(offset + 18) !== compressedSize || bytes.readUInt32LE(offset + 22) !== expandedSize)) throw invalid('Entrada XLSX inconsistente.');
    spans.push([offset, start + compressedSize]);
    let data;
    try {
      const compressed = bytes.subarray(start, start + compressedSize);
      data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, expandedSize) });
    } catch { throw invalid('Planilha corrompida ou acima dos limites de descompactação.'); }
    if (data.length !== expandedSize || crc32(data) !== crc) throw invalid('A planilha está corrompida. Salve novamente como .xlsx.');
    if (/\.xml$|\.rels$/i.test(name)) {
      const xml = data.toString('utf8');
      if (/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject/i.test(xml)) throw invalid('Planilha contém estruturas XML ou macros não permitidas.');
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        let cells = 0;
        for (const match of xml.matchAll(/<(?:\w+:)?c\b[^>]*\br=["']([A-Z]+)(\d+)["']/g)) {
          let column = 0;
          for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
          if (++cells > MAX_SHEET_ROWS * MAX_SHEET_COLUMNS || Number(match[2]) > MAX_SHEET_ROWS || column > MAX_SHEET_COLUMNS) throw invalid('Use a área de preenchimento do modelo; a planilha contém células muito distantes ou colunas extras.');
        }
      }
    }
    pos = next;
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((span, i) => i && span[0] < spans[i - 1][1]) || pos !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw invalid('Arquivo XLSX inválido.');
}

function plainCell(cell, key) {
  const value = cell.value;
  if (value == null || value === '') return '';
  if (cell.isMerged) throw invalid('Desfaça as células mescladas da área de trabalhadores.');
  if (value instanceof Date) {
    if (key !== 'dataAdmissao' || Number.isNaN(value.getTime())) throw invalid('Use texto neste campo; datas são aceitas somente na coluna Data de admissão.');
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) throw invalid('Substitua as fórmulas por valores antes de importar.');
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (typeof value.text === 'string' && typeof value.hyperlink === 'string') return value.text;
    throw invalid('Use texto simples ou uma data válida neste campo.');
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw invalid('Use texto para preservar o conteúdo deste campo.');
    if (key === 'matriculaESocial') throw invalid('Formate a matrícula eSocial como Texto e confira os zeros à esquerda.');
    if (key === 'cpf') return String(value).padStart(11, '0');
  }
  if (!['string', 'number'].includes(typeof value)) throw invalid('Use texto simples neste campo.');
  return String(value).trim();
}

export async function readWorkerXlsx(bytes) {
  validateXlsxArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes, { ignoreNodes: ['drawing', 'picture', 'conditionalFormatting', 'dataValidations', 'extLst'] }); }
  catch { throw invalid('Não foi possível ler a planilha. Salve novamente como .xlsx usando o modelo disponível.'); }
  const sheet = workbook.worksheets.find(item => normalizeHeader(item.name) === 'trabalhadores');
  if (!sheet) throw invalid('A planilha deve conter a aba Trabalhadores do modelo.');
  if (sheet.rowCount > MAX_SHEET_ROWS || sheet.columnCount > MAX_SHEET_COLUMNS) throw invalid('Use a área de preenchimento do modelo da planilha.');
  const headers = new Map();
  const keys = new Set();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const label = plainCell(cell, 'header');
    if (!label) return;
    const definition = aliases.get(normalizeHeader(label));
    if (!definition) throw invalid(`Coluna não reconhecida: ${label.slice(0, 60)}. Use o cabeçalho do modelo.`);
    if (keys.has(definition.key)) throw invalid(`Coluna repetida: ${definition.label}.`);
    headers.set(columnNumber, definition);
    keys.add(definition.key);
  });
  const missing = WORKER_COLUMNS.filter(column => column.required && !keys.has(column.key));
  if (missing.length) throw invalid(`Colunas obrigatórias ausentes: ${missing.map(column => column.label).join(', ')}.`);
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number === 1) return;
    const data = {};
    const errors = [];
    let populated = false;
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (cell.value == null || cell.value === '') return;
      populated = true;
      const definition = headers.get(columnNumber);
      if (!definition) { errors.push('Há conteúdo em uma coluna sem cabeçalho reconhecido.'); return; }
      try { data[definition.key] = plainCell(cell, definition.key); }
      catch (error) { errors.push(`${definition.label}: ${error.message}`); }
    });
    if (populated) rows.push({ linha: number, data, erros: errors });
  });
  if (rows.length > WORKER_IMPORT_LIMIT) throw httpError(400, `Cada planilha admite até ${WORKER_IMPORT_LIMIT} trabalhadores. Divida a relação em arquivos menores.`, 'IMPORTACAO_LIMITE');
  return rows;
}
