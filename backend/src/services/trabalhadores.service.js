import { randomUUID } from 'node:crypto';
import { httpError } from '../middleware/auth.js';

export const WORKER_IMPORT_LIMIT = 500;
export const WORKER_IMPORT_TTL_MS = 30 * 60 * 1000;
export const WORKER_COLUMNS = Object.freeze([
  { key: 'nomeCompleto', label: 'Nome completo', required: true, max: 300 },
  { key: 'cpf', label: 'CPF', required: true, max: 20 },
  { key: 'matriculaESocial', label: 'Matrícula eSocial', required: true },
  { key: 'funcao', label: 'Função', required: true, max: 300 },
  { key: 'localidade', label: 'Localidade', required: true, max: 300 },
  { key: 'setor', label: 'Setor', max: 300 },
  { key: 'dataAdmissao', label: 'Data de admissão', max: 10 },
  { key: 'rg', label: 'RG', max: 40 },
  { key: 'email', label: 'E-mail', max: 254 },
  { key: 'telefone', label: 'Telefone', max: 40 },
  { key: 'status', label: 'Status', max: 20 },
  { key: 'observacoes', label: 'Observações', max: 1000 }
]);
const optionalKeys = WORKER_COLUMNS.filter(column => !column.required).map(column => column.key);
const alphabetical = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

export function foldIdentity(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleUpperCase('pt-BR');
}

export function normalizeCPF(value) {
  const text = String(value ?? '').trim();
  return /^[\d.\-\s]+$/.test(text) ? text.replace(/[.\-\s]/g, '') : '';
}

export function validCPF(value) {
  const cpf = normalizeCPF(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const digit = (sum * 10) % 11;
    if ((digit === 10 ? 0 : digit) !== Number(cpf[length])) return false;
  }
  return true;
}

export function workerDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const parts = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function validateWorker(input = {}, { strictCPF = true } = {}) {
  const data = {};
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { data, errors: ['Linha de trabalhador inválida.'] };
  const source = { ...input, nomeCompleto: input.nomeCompleto ?? input.nome, matriculaESocial: input.matriculaESocial ?? input.matriculaEsocial };
  for (const column of WORKER_COLUMNS) {
    const value = source[column.key];
    if (value != null && !['string', 'number'].includes(typeof value)) {
      errors.push(`${column.label}: use texto simples.`);
      continue;
    }
    const supplied = String(value ?? '');
    // Matrícula is an opaque identifier: preserve letters, digits, case and leading zeros.
    // It has no field length cap; the common request/file/record size limits still apply.
    const text = (column.key === 'matriculaESocial' ? supplied : supplied.normalize('NFC')).trim();
    if (!text) {
      if (column.required) errors.push(`${column.label}: preenchimento obrigatório.`);
      continue;
    }
    if ((column.max != null && text.length > column.max) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
      errors.push(column.max == null ? `${column.label}: conteúdo inválido.` : `${column.label}: conteúdo inválido ou acima de ${column.max} caracteres.`);
      continue;
    }
    if (/^=/.test(text)) {
      errors.push(`${column.label}: use um valor, sem fórmula.`);
      continue;
    }
    data[column.key] = text;
  }
  if (data.cpf) {
    const cpf = normalizeCPF(data.cpf);
    if (!/^\d{11}$/.test(cpf) || (strictCPF && !validCPF(cpf))) errors.push('CPF: informe os 11 dígitos de um CPF válido.');
    else data.cpf = cpf;
  }
  if (data.dataAdmissao) {
    const date = workerDate(data.dataAdmissao);
    if (!date) errors.push('Data de admissão: use uma data válida no formato DD/MM/AAAA ou AAAA-MM-DD.');
    else data.dataAdmissao = date;
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('E-mail: endereço inválido.');
  if (data.status) {
    const status = foldIdentity(data.status);
    if (!['ATIVO', 'INATIVO'].includes(status)) errors.push('Status: use Ativo ou Inativo.');
    else data.status = status === 'ATIVO' ? 'Ativo' : 'Inativo';
  }
  if (data.nomeCompleto) data.nome = data.nomeCompleto;
  return { data, errors };
}

export function requireValidWorker(input, options) {
  const result = validateWorker(input, options);
  if (result.errors.length) throw httpError(400, result.errors.join(' '), 'TRABALHADOR_INVALIDO');
  return result.data;
}

export function sortWorkers(items) {
  return [...items].sort((a, b) => alphabetical.compare(a.nomeCompleto || a.nome || '', b.nomeCompleto || b.nome || '')
    || alphabetical.compare(a.matriculaESocial || a.matriculaEsocial || '', b.matriculaESocial || b.matriculaEsocial || '')
    || String(a.id).localeCompare(String(b.id)));
}

function indexBy(items, getter) {
  const index = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(item);
  }
  return index;
}

function identityIndex(items) {
  return {
    cpf: indexBy(items, item => normalizeCPF(item.cpf)),
    matricula: indexBy(items, item => foldIdentity(item.matriculaESocial ?? item.matriculaEsocial))
  };
}

export function findWorkerIdentity(data, existing) {
  const index = existing?.cpf instanceof Map ? existing : identityIndex(existing);
  const byCPF = index.cpf.get(normalizeCPF(data.cpf)) || [];
  const byMatricula = index.matricula.get(foldIdentity(data.matriculaESocial)) || [];
  if (byCPF.length > 1 || byMatricula.length > 1) return { error: 'CPF ou matrícula já aparece em mais de um cadastro desta empresa. Regularize a duplicidade antes de sincronizar.' };
  if (!byCPF.length && !byMatricula.length) return { item: null };
  if (byCPF.length === 1 && byMatricula.length === 1 && byCPF[0].id === byMatricula[0].id) return { item: byCPF[0] };
  return { error: 'CPF e matrícula eSocial não correspondem ao mesmo cadastro. Confira os dois identificadores; a importação não altera a identidade do trabalhador.' };
}

export function buildWorkerImport({ rows, existing, empresaId, actor, now = new Date() }) {
  if (!Array.isArray(rows) || !rows.length) throw httpError(400, 'A planilha não contém trabalhadores preenchidos.', 'IMPORTACAO_VAZIA');
  if (rows.length > WORKER_IMPORT_LIMIT) throw httpError(400, `Cada planilha admite até ${WORKER_IMPORT_LIMIT} trabalhadores. Divida a relação em arquivos menores.`, 'IMPORTACAO_LIMITE');
  if (!empresaId || existing.some(item => item.empresaId !== empresaId)) throw httpError(403, 'Relação de trabalhadores incompatível com a empresa selecionada.', 'EMPRESA_NAO_AUTORIZADA');
  const companyIndex = identityIndex(existing);
  const normalizedRows = rows.map(row => {
    const validation = validateWorker(row.data);
    return { linha: row.linha, data: validation.data, errors: [...(row.erros || []), ...validation.errors] };
  });
  const incoming = identityIndex(normalizedRows.map(row => ({ ...row.data, id: row.linha })));
  const writes = [];
  const report = [];
  const summary = { total: rows.length, criar: 0, atualizar: 0, inalterados: 0, erros: 0 };
  for (const row of normalizedRows) {
    const { data, errors } = row;
    const duplicateCPF = incoming.cpf.get(normalizeCPF(data.cpf));
    const duplicateMatricula = incoming.matricula.get(foldIdentity(data.matriculaESocial));
    if (duplicateCPF?.length > 1) errors.push('CPF repetido na planilha. Mantenha somente uma linha por trabalhador.');
    if (duplicateMatricula?.length > 1) errors.push('Matrícula eSocial repetida na planilha. Mantenha somente uma linha por trabalhador.');
    let action = 'erro';
    let target = null;
    let changed = [];
    if (!errors.length) {
      const match = findWorkerIdentity(data, companyIndex);
      if (match.error) errors.push(match.error);
      else if (match.item) {
        target = match.item;
        const changes = { ...data };
        // Empty optional cells deliberately preserve current values. An omitted worker is never deleted.
        for (const key of optionalKeys) if (!(key in data)) delete changes[key];
        changed = Object.keys(changes).filter(key => String(target[key] ?? '') !== String(changes[key] ?? ''));
        action = changed.length ? 'atualizar' : 'inalterado';
        if (changed.length) writes.push({ linha: row.linha, type: 'update', entity: 'trabalhador', id: target.id, data: { ...changes, atualizadoPor: actor }, expectedVersion: target._version || 1, expectedUpdatedAt: target.updatedAt });
      } else {
        action = 'criar';
        target = { id: randomUUID() };
        writes.push({ linha: row.linha, type: 'create', entity: 'trabalhador', id: target.id, data: { ...data, status: data.status || 'Ativo', empresaId, criadoPor: actor } });
      }
    }
    if (errors.length) summary.erros++;
    else if (action === 'inalterado') summary.inalterados++;
    else summary[action]++;
    report.push({ linha: row.linha, acao: errors.length ? 'erro' : action, nomeCompleto: data.nomeCompleto || '', cpf: data.cpf || '', matriculaESocial: data.matriculaESocial || '', camposAlterados: changed, erros: [...new Set(errors)] });
  }
  const canConfirm = summary.erros === 0 && (summary.criar + summary.atualizar > 0);
  return {
    empresaId,
    autorSub: actor,
    status: canConfirm ? 'pendente' : summary.erros ? 'invalida' : 'sem_alteracoes',
    expiresAt: new Date(now.getTime() + WORKER_IMPORT_TTL_MS).toISOString(),
    resumo: summary,
    linhas: report,
    podeConfirmar: canConfirm,
    writes: canConfirm ? writes : []
  };
}

export function publicImport(item) {
  return {
    importacaoId: item.id,
    arquivoNome: item.arquivoNome,
    expiresAt: item.expiresAt,
    status: item.status,
    resumo: item.resumo,
    linhas: item.linhas,
    podeConfirmar: item.podeConfirmar === true && ['pendente', 'em_andamento'].includes(item.status),
    ...(item.confirmedAt ? { confirmedAt: item.confirmedAt } : {})
  };
}
