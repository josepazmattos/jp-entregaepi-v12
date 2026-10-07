import { assertCompanyAccess, httpError } from '../middleware/auth.js';

export function empresaIdFrom(req) {
  const supplied = [req.query?.empresaId, req.headers?.['x-empresa-id'], req.body?.empresaId].filter(value => value != null && value !== '');
  if (supplied.some(value => !['string', 'number'].includes(typeof value))) throw httpError(400, 'empresaId inválido.', 'EMPRESA_INVALIDA');
  const values = supplied.map(value => String(value).trim());
  if (values.some(value => !value || value.length > 128) || new Set(values).size > 1) throw httpError(400, 'Os vínculos de empresa enviados são divergentes.', 'EMPRESA_DIVERGENTE');
  const empresaId = values[0] || (!req.auth?.master ? req.auth?.empresaIds?.[0] : null) || null;
  if (empresaId) assertCompanyAccess(req, empresaId);
  return empresaId;
}

export function assertRecordAccess(req, item) {
  assertCompanyAccess(req, item.empresaId);
  const selected = empresaIdFrom(req);
  if (selected && selected !== item.empresaId) throw httpError(403, 'O registro não pertence à empresa selecionada.', 'EMPRESA_NAO_AUTORIZADA');
}

export function objectBody(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw httpError(400, 'Envie um objeto JSON válido.', 'CORPO_INVALIDO');
  return req.body;
}

export function textField(value, { required = false, field = 'Campo', max = 1000 } = {}) {
  if (value == null || value === '') {
    if (required) throw httpError(400, `${field} é obrigatório.`, 'CAMPO_OBRIGATORIO');
    return '';
  }
  if (!['string', 'number'].includes(typeof value)) throw httpError(400, `${field} inválido.`, 'CAMPO_INVALIDO');
  const text = String(value).trim();
  if ((required && !text) || text.length > max) throw httpError(400, `${field} inválido.`, 'CAMPO_INVALIDO');
  return text;
}

export function pickText(body, fields) {
  return Object.fromEntries(fields.filter(field => body[field] != null).map(field => [field, textField(body[field], { field })]));
}

export function ok(res, data = {}) {
  res.json({ ok: true, ...data });
}

export function fail(res, status, error, extra = {}) {
  res.status(status).json({ ok: false, error, ...extra });
}
