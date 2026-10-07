import { Router } from 'express';
import * as storage from '../db/store.js';
import { list, get, create, update, listWithRevision, transact } from '../db/store.js';
import { ok, fail, empresaIdFrom, objectBody, assertRecordAccess } from './_helpers.js';
import { httpError } from '../middleware/auth.js';
import { createBiometricsService } from '../services/biometria.service.js';
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

const biometrics = createBiometricsService(storage);
async function selectedWorker(req) {
  const worker = await get('trabalhador', req.params.id);
  if (!worker) throw httpError(404, 'Trabalhador não encontrado.');
  assertRecordAccess(req, worker); return worker;
}
router.patch('/:id', async (req,res) => {
  const worker=await selectedWorker(req);
  ok(res, await importer.editWorker({body:objectBody(req),worker,actor:req.auth.sub}));
});
router.post('/:id/biometria/desafio', async (req,res) => {
  const worker=await selectedWorker(req), body=objectBody(req);
  ok(res,{challenge:await biometrics.challenge({worker,fingerCode:body.fingerCode,actor:req.auth.sub,kind:'enroll'})});
});
router.post('/:id/biometria', async (req,res) => {
  const worker=await selectedWorker(req);
  ok(res,await biometrics.complete({body:objectBody(req),worker,actor:req.auth.sub,kind:'enroll'}));
});
export default router;
