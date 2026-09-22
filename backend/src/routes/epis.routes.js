import { Router } from 'express';
import { create, list } from '../db/store.js';
import { ok, fail, empresaIdFrom } from './_helpers.js';
import { consultarCA } from '../services/caepi.service.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('epi', empresaIdFrom(req)) }));

router.get('/ca/:ca', async (req, res) => ok(res, { item: await consultarCA(req.params.ca) }));

router.post('/', async (req, res) => {
  const empresaId = empresaIdFrom(req);
  if (!empresaId) return fail(res, 400, 'empresaId é obrigatório');
  if (!req.body?.ca) return fail(res, 400, 'CA é obrigatório');
  if (!req.body?.descricao) return fail(res, 400, 'Descrição do EPI é obrigatória');
  const item = await create('epi', { ...req.body, empresaId });
  ok(res, { item });
});

export default router;
