export const gatewayClaimsKey = Symbol('trusted-api-gateway-jwt-claims');

export function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function groupsFrom(value) {
  if (Array.isArray(value)) return value.filter(group => typeof group === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(group => typeof group === 'string');
  } catch { /* HTTP API may serialize Cognito groups as [MASTER, EMPRESA]. */ }
  return value.replace(/^\[|\]$/g, '').split(',').map(group => group.trim());
}

export function createAuthorization({ issuer, audience, companyClaim = '' } = {}) {
  return function authorization(req, res, next) {
    const claims = req[gatewayClaimsKey];
    if (!claims || typeof claims !== 'object' || !claims.sub) {
      return next(httpError(401, 'Autenticação obrigatória. Entre novamente no aplicativo.', 'AUTENTICACAO_OBRIGATORIA'));
    }
    if (!issuer || !audience) return next(httpError(503, 'Autorização indisponível: configuração Cognito incompleta.', 'AUTORIZACAO_NAO_CONFIGURADA'));
    const expires = Number(claims.exp);
    if (claims.iss !== issuer || claims.aud !== audience || claims.token_use !== 'id' || !Number.isFinite(expires) || expires * 1000 <= Date.now()) {
      return next(httpError(401, 'Sessão inválida ou expirada. Entre novamente no aplicativo.', 'SESSAO_INVALIDA'));
    }
    const groups = groupsFrom(claims['cognito:groups']);
    const master = groups.includes('MASTER');
    let empresaIds = [];
    // Enable only after this claim is assigned by trusted administration and not user-writable.
    if (!master && groups.includes('EMPRESA') && companyClaim) {
      const company = claims[companyClaim];
      if (typeof company === 'string' && company.trim() && company.length <= 128) empresaIds = [company.trim()];
    }
    if (!master && !empresaIds.length) return next(httpError(403, 'Perfil ou vínculo com a empresa não configurado. Solicite ajuste ao administrador.', 'PERFIL_NAO_CONFIGURADO'));
    req.auth = Object.freeze({ sub: String(claims.sub), master, empresaIds: Object.freeze(empresaIds) });
    next();
  };
}

export function assertCompanyAccess(req, empresaId) {
  if (!req.auth) throw httpError(401, 'Autenticação obrigatória.', 'AUTENTICACAO_OBRIGATORIA');
  if (!req.auth.master && !req.auth.empresaIds.includes(String(empresaId || ''))) {
    throw httpError(403, 'Acesso não permitido a esta empresa.', 'EMPRESA_NAO_AUTORIZADA');
  }
}

export function requireMaster(req, res, next) {
  if (!req.auth?.master) return next(httpError(403, 'Esta operação exige o perfil MASTER.', 'PERFIL_NAO_AUTORIZADO'));
  next();
}

export const requireAuth = createAuthorization({
  issuer: process.env.COGNITO_ISSUER,
  audience: process.env.COGNITO_CLIENT_ID,
  companyClaim: process.env.AUTH_COMPANY_CLAIM || ''
});
