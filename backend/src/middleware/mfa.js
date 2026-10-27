import { bearer, mfaSessions, securityEvent } from '../security/session.js';
import { httpError } from './auth.js';
export function createMfaGuard({ enabled = process.env.MASTER_MFA_REQUIRED === 'true', sessions = mfaSessions } = {}) {
  return async (req, res, next) => {
    if (!enabled || !req.auth?.master || req.path === '/seguranca/status') return next();
    const token = bearer(req.headers);
    if (!await sessions.verified(token, { sub: req.auth.sub, auth_time: req.auth.authTime, exp: req.auth.expires })) {
      securityEvent('MASTER_ACCESS', 'denied', { actor: req.auth.sub, code: 'MFA_REQUIRED' });
      throw httpError(403, 'Ative e confirme o autenticador para continuar como Master.', 'MFA_REQUIRED');
    }
    next();
  };
}
