import { Router } from 'express';
import * as storage from '../db/store.js';
import { list, listForDisplay, get, create, update, listWithRevision, transact } from '../db/store.js';
import { ok, fail, empresaIdFrom, objectBody, assertRecordAccess, recentListIds } from './_helpers.js';
import { httpError, requireMaster } from '../middleware/auth.js';
import { createBiometricsService } from '../services/biometria.service.js';
import { sortWorkers } from '../services/trabalhadores.service.js';
import { createWorkerImportService } from '../services/trabalhadores-import.service.js';
import { companyForReport, workerForReport, workerEnrollmentSummary } from '../services/biometric-records.js';

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
  if (empresaId) ok(res, { items: sortWorkers(await listForDisplay('trabalhador', empresaId, recentListIds(req))) });
});

router.get('/relatorio-biometrico', async (req,res) => {
  const empresaId=await selectedCompany(req,res); if(!empresaId)return;
  const company=await get('empresa',empresaId);
  const workers=sortWorkers(await listForDisplay('trabalhador',empresaId,recentListIds(req)))
    .filter(worker=>worker.empresaId===empresaId).map(workerEnrollmentSummary);
  res.set('Cache-Control','private, no-store');
  ok(res,{empresa:companyForReport(company),trabalhadores:workers,emitidoEm:new Date().toISOString()});
});

router.post('/', async (req, res) => {
  const body = objectBody(req);
  const empresaId = await selectedCompany(req, res);
  if (empresaId) ok(res, await importer.createWorker({ body, empresaId, actor: req.auth.sub }));
});

router.post('/importacao/previa', requireMaster, async (req, res) => {
  const body = objectBody(req);
  const empresaId = await selectedCompany(req, res);
  if (!empresaId) return;
  ok(res, await importer.preview({ arquivoNome: body.arquivoNome, arquivoBase64: body.arquivoBase64, empresaId, actor: req.auth.sub }));
});

router.post('/importacao/soc/previa', requireMaster, async (req, res) => {
  const body = objectBody(req);
  const empresaId = await selectedCompany(req, res);
  if (!empresaId) return;
  ok(res, await importer.preview({ arquivoNome: body.arquivoNome, arquivoBase64: body.arquivoBase64, empresaId, actor: req.auth.sub, origem: 'soc', master: req.auth.master, matriculaColumn: body.matriculaColumn }));
});

router.get('/importacao/:id', requireMaster, async (req, res) => {
  const empresaId = await selectedCompany(req, res);
  if (empresaId) ok(res, await importer.getProgress({ id: req.params.id, empresaId, actor: req.auth.sub, master: req.auth.master }));
});

router.post('/importacao/:id/confirmar', requireMaster, async (req, res) => {
  const body = objectBody(req);
  const empresaId = await selectedCompany(req, res);
  if (!empresaId) return;
  try { ok(res, await importer.confirm({ id: req.params.id, empresaId, actor: req.auth.sub, master: req.auth.master, compact: body.resumo === true })); }
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
router.get('/:id/biometrias', async (req,res) => { const worker=await selectedWorker(req); ok(res,{items:await biometrics.gallery(worker)}); });
router.get('/:id/cadastro-biometrico', async (req,res) => {
  const worker=await selectedWorker(req),company=await get('empresa',worker.empresaId);
  if(!company)throw httpError(404,'Empresa não encontrada.');
  res.set('Cache-Control','private, no-store');
  ok(res,{empresa:companyForReport(company),trabalhador:workerForReport(worker),digitais:await biometrics.records(worker),emitidoEm:new Date().toISOString()});
});
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
