import { Router } from 'express';
import { create, list, get, remove } from '../db/store.js';
import { ok, fail, empresaIdFrom } from './_helpers.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('ficha', empresaIdFrom(req)) }));

router.post('/', async (req, res) => {
  const empresaId = empresaIdFrom(req);
  if (!empresaId) return fail(res, 400, 'empresaId é obrigatório');
  if (!req.body?.trabalhadorId) return fail(res, 400, 'trabalhadorId é obrigatório');
  if (!Array.isArray(req.body?.itens) || !req.body.itens.length) return fail(res, 400, 'A ficha precisa de pelo menos um EPI');
  const item = await create('ficha', { ...req.body, empresaId, status: 'pendente' });
  ok(res, { item });
});

router.post('/:id/assinar', async (req, res) => {
  const ficha = await get('ficha', req.params.id);
  if (!ficha) return fail(res, 404, 'Ficha não encontrada');
  const assinatura = req.body || {};
  if (!assinatura.realFingerImage) return fail(res, 400, 'Assinatura bloqueada: imagem real da digital é obrigatória');
  if (!assinatura.dedo) return fail(res, 400, 'Dedo utilizado é obrigatório');
  const item = await create('ficha', { ...ficha, id: ficha.id, status: 'assinada', assinaturaBiometrica: assinatura });
  ok(res, { item });
});

router.delete('/:id', async (req, res) => {
  const ficha = await get('ficha', req.params.id);
  if (!ficha) return fail(res, 404, 'Ficha não encontrada');
  if (ficha.status === 'assinada') {
    const item = await create('ficha', { ...ficha, id: ficha.id, status: 'cancelada', motivoCancelamento: req.body?.motivo || 'Cancelada pelo usuário' });
    return ok(res, { item });
  }
  await remove('ficha', req.params.id);
  ok(res, { deleted: true });
});

export default router;
