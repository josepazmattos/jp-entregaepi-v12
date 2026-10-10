import { Router } from 'express';
import * as storage from '../db/store.js';
import { httpError } from '../middleware/auth.js';
import { normalizeCompanyLogin } from '../services/empresa-validation.js';

// Public sign-in lookup only: no password, company profile, tokens or contact data.
export function createLoginRouter({ getCompanyByLogin = storage.getCompanyByLogin } = {}) {
  const router = Router();
  router.post('/resolver', async (req, res) => {
    const login = normalizeCompanyLogin(req.body?.login);
    const company = await getCompanyByLogin(login);
    if (company && (company.excluidaEm || company.login !== login)) throw httpError(400, 'Usuário ou senha inválidos. Confira o login atual da empresa.', 'LOGIN_INVALIDO');
    res.json({ ok: true, username: company?.cognitoUsername || login });
  });
  return router;
}
export default createLoginRouter();
