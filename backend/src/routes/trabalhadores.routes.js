import { Router } from 'express';
import { list, get, create, update, listWithRevision, transact } from '../db/store.js';
import { ok, fail, empresaIdFrom, objectBody } from './_helpers.js';
import { sortWorkers } from '../services/trabalhadores.service.js';
import { createWorkerImportService } from '../services/trabalhadores-import.service.js';

const router = Router();
const importer = createWorkerImportService({ list, get, create, update, listWithRevision, transact });

async function selectedCompany(req, res) {
  const empresaId = empresaIdFrom(req);
  if (!empresaId) { fail(res, 400, 'Selecione a empresa para acessar os trabalhadores.', { code: 'EMPRESA_OBRIGATORIA' }); return null; }
  if (!await get('empresa', empresaId)) { fail(res, 404, 'Empresa não encontrada'); return null; }
  return empresaId;
}

router.get('/', async (req, res) => {
  const empresaId = await selectedCompany(req, res);
  if (empresaId) ok(res, { items: sortWorkers(await list('trabalhador', empresaId)) });
});

router.post('/', async (req, res) => {
  const body = objectBody(req);
  const empresaId = await selectedCompany(req, res);
  if (empresaId) ok(res, await importer.createWorker({ body, empresaId, actor: req.auth.sub }));
});

router.post('/importacao/previa', async (req, res) => {
  const body = objectBody(req);
  const empresaId = await selectedCompany(req, res);
  if (!empresaId) return;
  ok(res, await importer.preview({ arquivoNome: body.arquivoNome, arquivoBase64: body.arquivoBase64, empresaId, actor: req.auth.sub }));
});

router.get('/importacao/:id', async (req, res) => {
  const empresaId = await selectedCompany(req, res);
  if (empresaId) ok(res, await importer.getProgress({ id: req.params.id, empresaId, actor: req.auth.sub }));
});

router.post('/importacao/:id/confirmar', async (req, res) => {
  objectBody(req);
  const empresaId = await selectedCompany(req, res);
  if (!empresaId) return;
  try { ok(res, await importer.confirm({ id: req.params.id, empresaId, actor: req.auth.sub })); }
  catch (error) {
    if (!error.importacao) throw error;
    fail(res, error.status, error.message, { code: error.code, importacao: error.importacao });
  }
});

export default router;
