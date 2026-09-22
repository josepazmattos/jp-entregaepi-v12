import { Router } from 'express';
import { create, list } from '../db/store.js';
import { ok, empresaIdFrom } from './_helpers.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('auditoria', empresaIdFrom(req)) }));
router.post('/', async (req, res) => ok(res, { item: await create('auditoria', { ...req.body, empresaId: empresaIdFrom(req) }) }));

export default router;
