import { httpError } from './auth.js';
// Revokes application access even for JWTs issued before a company was excluded.
export function companyActive(storage) {
  return async (req, res, next) => {
    const ids = new Set(req.auth.master ? [] : req.auth.empresaIds);
    if (/^\/(trabalhadores|fichas)(\/|$)/.test(req.path)) {
      for (const id of [req.headers['x-empresa-id'], req.query.empresaId, req.body?.empresaId]) if (typeof id === 'string' && id) ids.add(id);
      const match = req.path.match(/^\/(trabalhadores|fichas)\/([^/]+)/);
      if (match && match[2] !== 'importacao') {
        const record = await storage.get(match[1] === 'trabalhadores' ? 'trabalhador' : 'ficha', decodeURIComponent(match[2]));
        if (record?.empresaId) ids.add(record.empresaId);
      }
    }
    for (const id of ids) {
      const company = await storage.get('empresa', id);
      if (company?.excluidaEm) throw httpError(403, 'Esta empresa foi excluída. O acesso está bloqueado.', 'EMPRESA_EXCLUIDA');
    }
    next();
  };
}
