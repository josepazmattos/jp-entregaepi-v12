import { Router } from 'express';
import * as defaultStorage from '../db/store.js';
import { ok, objectBody, recentListIds } from './_helpers.js';
import { assertCompanyAccess, requireMaster, httpError } from '../middleware/auth.js';
import { createCompanyService, publicCompany } from '../services/empresa.service.js';
import { companyAccounts } from '../services/company-accounts.js';
import { bearer } from '../security/session.js';
import { invokeSecurity } from '../security/remote.js';

export function createEmpresasRouter({ storage = defaultStorage, accounts = companyAccounts } = {}) {
  const router = Router();
  const service = createCompanyService({ storage, accounts });
  const requestService = req => !process.env.VAULT_ADMIN_FUNCTION ? service : createCompanyService({storage,accounts:{...accounts,
    ensureCompanyAccess: ({companyId})=>invokeSecurity(process.env.VAULT_ADMIN_FUNCTION,{action:'account-ensure',company:companyId,token:bearer(req.headers)}),
    resetCompanyPassword: ({companyId})=>invokeSecurity(process.env.VAULT_ADMIN_FUNCTION,{action:'account-reset',company:companyId,token:bearer(req.headers)})
  }});

  router.get('/', async (req, res) => {
    const items = req.auth.master
      ? await (storage.listForDisplay || storage.list)('empresa', null, recentListIds(req))
      : (await Promise.all(req.auth.empresaIds.map(id => storage.get('empresa', id)))).filter(Boolean);
    ok(res, { items: items.filter(item => !item.excluidaEm).map(publicCompany) });
  });

  router.get('/:id', async (req, res) => {
    assertCompanyAccess(req, req.params.id);
    ok(res, { item: publicCompany(await service.company(req.params.id)) });
  });

  router.post('/', requireMaster, async (req, res) => {
    const result = await requestService(req).register(objectBody(req), req.auth.sub);
    res.status(result.acesso.status === 'ativo' ? 200 : 202);
    ok(res, result);
  });

  router.post('/:id/acesso', requireMaster, async (req, res) => {
    const result = await requestService(req).resume(req.params.id, objectBody(req), req.auth.sub);
    res.status(result.acesso.status === 'ativo' ? 200 : 202);
    ok(res, result);
  });

  router.patch('/:id', requireMaster, async (req, res) => {
    assertCompanyAccess(req, req.params.id);
    const body = objectBody(req);
    if (body._version != null && (!Number.isSafeInteger(body._version) || body._version < 1)) throw httpError(400, 'A versão do cadastro é inválida. Atualize a tela.', 'EMPRESA_VERSAO_INVALIDA');
    ok(res, { item: await service.edit(req.params.id, body, { expectedVersion: body._version, master: req.auth.master, actor: req.auth.sub }) });
  });
  router.post('/:id/restaurar-senha', requireMaster, async (req, res) => { ok(res, await requestService(req).resetPassword(req.params.id, objectBody(req), req.auth.sub)); });
  router.delete('/:id', requireMaster, async (req,res) => { ok(res, await service.exclude(req.params.id, objectBody(req), req.auth.sub)); });
  return router;
}

export default createEmpresasRouter();
