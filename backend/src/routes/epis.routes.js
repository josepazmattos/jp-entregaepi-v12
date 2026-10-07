import { Router } from 'express';
import { list, get, listWithRevision, transact } from '../db/store.js';
import { ok, empresaIdFrom, objectBody } from './_helpers.js';
import { consultarCA } from '../services/caepi.service.js';
import { normalizeEquipment, listEquipmentCatalog, publicEquipment, equipmentKey, findEquipment } from '../services/epis.service.js';

const router = Router();
const scope = 'catalogo:epis';
const conflicts = new Set(['REGISTRO_ALTERADO', 'ESCOPO_ALTERADO', 'CONCORRENCIA_CONFLITO', 'TRANSACAO_CONFLITO']);

router.get('/', async (req, res) => {
  empresaIdFrom(req); // Validate a supplied company context, even though only technical catalog fields are shared.
  ok(res, { items: listEquipmentCatalog(await list('epi')), compartilhado: true });
});
router.get('/ca/:ca', async (req, res) => ok(res, { item: await consultarCA(req.params.ca) }));

router.post('/', async (req, res) => {
  empresaIdFrom(req);
  const data = normalizeEquipment(objectBody(req));
  const key = equipmentKey(data);
  const id = `catalogo-${key}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await listWithRevision('epi', null, scope);
    const existing = findEquipment(snapshot.items, data);
    if (existing) return ok(res, { item: publicEquipment(existing), reutilizado: true });
    try {
      await transact({ scope, expectedRevision: snapshot.revision, mutationId: `cadastro:${key}`, operations: [
        { type: 'create', entity: 'epi', id, data: { ...data, criadoPor: req.auth.sub } }
      ], result: { id } });
      return ok(res, { item: publicEquipment(await get('epi', id)), reutilizado: false });
    } catch (error) {
      if (error.code === 'IDEMPOTENCIA_DIVERGENTE') {
        // Two different companies may contribute this technical key concurrently.
        // Reuse only the matching catalog item; never overwrite it or suppress an unrelated conflict.
        const concurrent = findEquipment(await list('epi'), data);
        if (concurrent) return ok(res, { item: publicEquipment(concurrent), reutilizado: true });
      }
      if (!conflicts.has(error.code) || attempt === 3) throw error;
    }
  }
});

export default router;
