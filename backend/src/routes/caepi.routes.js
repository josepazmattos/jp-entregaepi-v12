import { Router } from 'express';
import { consultarCA, buscarPorNome } from '../services/caepi.service.js';
import { ok } from './_helpers.js';

const router = Router();

router.get('/:ca', async (req, res) => ok(res, { item: await consultarCA(req.params.ca) }));
router.get('/', async (req, res) => ok(res, { items: await buscarPorNome(req.query.q || '') }));

export default router;
