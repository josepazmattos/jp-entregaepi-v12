import { Router } from 'express';
import { create, list } from '../db/store.js';
import { ok, fail, empresaIdFrom } from './_helpers.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('trabalhador', empresaIdFrom(req)) }));

router.post('/', async (req, res) => {
  const empresaId = empresaIdFrom(req);
  if (!empresaId) return fail(res, 400, 'empresaId é obrigatório');
  const required = ['nomeCompleto', 'cpf', 'matriculaESocial', 'funcao', 'localidade'];
  const erros = required.filter(c => !req.body?.[c]).map(c => `${c} obrigatório`);
  if (erros.length) return fail(res, 400, 'Dados obrigatórios ausentes', { erros });
  const item = await create('trabalhador', { ...req.body, empresaId });
  ok(res, { item });
});

export default router;
