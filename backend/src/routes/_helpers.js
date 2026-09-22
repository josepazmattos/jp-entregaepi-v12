export function empresaIdFrom(req) {
  return req.query.empresaId || req.headers['x-empresa-id'] || req.body?.empresaId || null;
}

export function ok(res, data = {}) {
  res.json({ ok: true, ...data });
}

export function fail(res, status, error, extra = {}) {
  res.status(status).json({ ok: false, error, ...extra });
}
