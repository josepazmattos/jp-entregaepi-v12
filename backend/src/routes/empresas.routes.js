import { Router } from 'express';
import { create, list, get } from '../db/store.js';
import { ok, fail, objectBody, textField, pickText } from './_helpers.js';
import { assertCompanyAccess, requireMaster } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res) => {
  const items = req.auth.master ? await list('empresa') : (await Promise.all(req.auth.empresaIds.map(id => get('empresa', id)))).filter(Boolean);
  ok(res, { items });
});

router.get('/:id', async (req, res) => {
  assertCompanyAccess(req, req.params.id);
  const item = await get('empresa', req.params.id);
  if (!item) return fail(res, 404, 'Empresa não encontrada');
  ok(res, { item });
});

router.post('/', requireMaster, async (req, res) => {
  const body = objectBody(req);
  const nome = textField(body.nome, { required: true, field: 'Nome da empresa', max: 300 });
  const item = await create('empresa', {
    ...pickText(body, ['cnpj', 'localidade', 'uf', 'responsavel', 'email', 'telefone', 'logoUrl', 'masterUsuario']),
    ...(body.logoDataUrl ? { logoDataUrl: textField(body.logoDataUrl, { field: 'Logo', max: 200 * 1024 }) } : {}),
    nome,
    status: 'Ativa',
    criadoPor: req.auth.sub
  });
  ok(res, { item });
});

export default router;
