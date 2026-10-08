import { Router } from 'express';
import { create, list, get, remove, update } from '../db/store.js';
import { ok, fail, empresaIdFrom, objectBody, assertRecordAccess, textField } from './_helpers.js';
import * as storage from '../db/store.js';
import { httpError } from '../middleware/auth.js';
import { createBiometricsService } from '../services/biometria.service.js';
import { buildFicha } from '../services/ficha.service.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('ficha', empresaIdFrom(req)) }));

router.post('/', async (req, res) => {
  const body = objectBody(req);
  const empresaId = empresaIdFrom(req);
  if (!empresaId) return fail(res, 400, 'empresaId é obrigatório');
  const trabalhadorId = textField(body.trabalhadorId, { required: true, field: 'Trabalhador', max: 128 });
  const [empresa, trabalhador] = await Promise.all([get('empresa', empresaId), get('trabalhador', trabalhadorId)]);
  if (!empresa) return fail(res, 404, 'Empresa não encontrada');
  if (!trabalhador || trabalhador.empresaId !== empresaId) return fail(res, 403, 'O trabalhador não pertence à empresa selecionada');
  if (trabalhador.status === 'Inativo' && body.tipo !== 'Devolução') return fail(res, 409, 'O trabalhador está inativo');

  let itens = Array.isArray(body.itens) ? body.itens : [];
  if (!itens.length && body.epiId) {
    itens = [{ epiId: body.epiId, quantidade: body.quantidade ?? 1 }];
  }
  if (!itens.length) return fail(res, 400, 'A ficha precisa de pelo menos um EPI');
  if (itens.length > 100) return fail(res, 400, 'Uma ficha admite até 100 itens');
  const items = await Promise.all(itens.map(async requested => {
    if (!requested || typeof requested !== 'object' || Array.isArray(requested)) return { requested: {}, epi: null };
    const epiId = textField(requested.epiId, { required: true, field: 'EPI', max: 128 });
    return { requested, epi: await get('epi', epiId) };
  }));
  const item = await create('ficha', buildFicha({ empresaId, empresa, trabalhador, items, body, actor: req.auth.sub }));
  ok(res, { item });
});

const biometrics = createBiometricsService(storage);
async function signingContext(req) {
  const ficha=await get('ficha',req.params.id);
  if(!ficha) throw httpError(404,'Ficha não encontrada.');
  assertRecordAccess(req,ficha);
  const worker=await get('trabalhador',ficha.trabalhadorId);
  if(!worker || worker.empresaId!==ficha.empresaId) throw httpError(409,'Cadastro do trabalhador indisponível.');
  if(ficha.trabalhadorSnapshot?.cpf && String(ficha.trabalhadorSnapshot.cpf).replace(/\D/g,'')!==String(worker.cpf).replace(/\D/g,'')) throw httpError(409,'O CPF atual diverge do registrado na ficha. Confira a identidade do trabalhador.');
  return {ficha,worker,actor:req.auth.sub,kind:'verify'};
}
router.get('/:id/assinatura-contexto',async(req,res)=>{const {ficha,worker}=await signingContext(req);ok(res,{ficha,worker});});
router.post('/:id/biometria/desafio',async(req,res)=>{
  const context=await signingContext(req);
  ok(res,{challenge:await biometrics.challenge({...context,fingerCode:objectBody(req).fingerCode})});
});
router.post('/:id/assinar',async(req,res)=>{
  const context=await signingContext(req);
  ok(res,await biometrics.complete({...context,body:objectBody(req)}));
});

router.delete('/:id', async (req, res) => {
  const ficha = await get('ficha', req.params.id);
  if (!ficha) return fail(res, 404, 'Ficha não encontrada');
  assertRecordAccess(req, ficha);
  if (ficha.status === 'cancelada') return fail(res, 409, 'A ficha já está cancelada');
  const previous = { expectedVersion: ficha._version, expectedUpdatedAt: ficha.updatedAt };
  if (ficha.status === 'assinada' || ficha.assinaturaBiometrica) {
    const item = await update('ficha', ficha.id, { status: 'cancelada', statusAnterior: ficha.status, motivoCancelamento: textField(req.body?.motivo, { required: true, field: 'Motivo do cancelamento', max: 2000 }), canceladaPor: req.auth.sub, canceladaEm: new Date().toISOString() }, previous);
    return ok(res, { item });
  }
  await remove('ficha', req.params.id, previous);
  ok(res, { deleted: true });
});

export default router;
