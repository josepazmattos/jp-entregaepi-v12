import { Router } from 'express';
import { create, list } from '../db/store.js';
import { ok, objectBody, pickText } from './_helpers.js';
import { requireMaster } from '../middleware/auth.js';

const router = Router();
router.use(requireMaster);

router.get('/', async (req, res) => ok(res, { items: await list('auditoria') }));
router.post('/', async (req, res) => ok(res, { item: await create('auditoria', { ...pickText(objectBody(req), ['acao', 'descricao', 'recursoId', 'empresaId']), origem: 'anotacao_administrativa', autorSub: req.auth.sub }) }));

export default router;
