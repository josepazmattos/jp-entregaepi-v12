import { Router } from 'express';
import { create, list, get } from '../db/store.js';
import { ok, fail } from './_helpers.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('empresa') }));

router.get('/:id', async (req, res) => {
  const item = await get('empresa', req.params.id);
  if (!item) return fail(res, 404, 'Empresa não encontrada');
  ok(res, { item });
});

router.post('/', async (req, res) => {
  const { nome, cnpj, localidade } = req.body || {};
  if (!nome) return fail(res, 400, 'Nome da empresa é obrigatório');
  const item = await create('empresa', { nome, cnpj: cnpj || '', localidade: localidade || '', logoUrl: req.body.logoUrl || '', masterUsuario: req.body.masterUsuario || '' });
  ok(res, { item });
});

export default router;
