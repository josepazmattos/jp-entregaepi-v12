import {Router} from 'express';
import * as storage from '../db/store.js';
import {httpError} from '../middleware/auth.js';
import {empresaIdFrom,assertRecordAccess,objectBody,ok,textField} from './_helpers.js';
import {createOccurrenceService,publicOccurrence} from '../services/ocorrencias.service.js';
export function createOccurrencesRouter(db=storage,send) {
  const router=Router(),service=createOccurrenceService(db,send);
  router.use((req,res,next)=>{req.company=empresaIdFrom(req);if(!req.company)throw httpError(400,'Selecione uma empresa.');next();});
  async function record(req,kind,id){const item=await db.get(kind,textField(id,{required:true,max:128}));if(!item)throw httpError(404,'Registro não encontrado.');assertRecordAccess(req,item);return item;}
  router.get('/ocorrencias',async(req,res)=>ok(res,{items:(await db.listForDisplay('ocorrencia_epi',req.company)).map(publicOccurrence)}));
  router.get('/ocorrencias/:id',async(req,res)=>ok(res,{item:publicOccurrence(await record(req,'ocorrencia_epi',req.params.id))}));
  router.get('/ocorrencias/:id/ficha',async(req,res)=>{const item=await record(req,'ocorrencia_epi',req.params.id);ok(res,{item:await record(req,'ficha',req.query.reposicao==='true'?item.reposicaoFichaId:item.fichaId)});});
  router.post('/ocorrencias/:id/notificar',async(req,res)=>ok(res,{item:publicOccurrence(await service.notify(await record(req,'ocorrencia_epi',req.params.id),req.auth.sub))}));
  router.post('/ocorrencias/:id/reposicao',async(req,res)=>{const item=await record(req,'ocorrencia_epi',req.params.id),ficha=await record(req,'ficha',objectBody(req).fichaId);ok(res,{item:publicOccurrence(await service.link(item,ficha,req.auth.sub))});});
  router.post('/:id/ocorrencias',async(req,res)=>{const ficha=await record(req,'ficha',req.params.id);ok(res,{item:publicOccurrence(await service.register(ficha,objectBody(req),req.auth.sub))});});
  return router;
}
export default createOccurrencesRouter();
