import { Router } from 'express';
import * as store from '../db/store.js';
import { gedStorage } from '../db/jpged.js';
import { createGedService } from '../services/jpged.service.js';
import { empresaIdFrom, assertRecordAccess, objectBody, ok } from './_helpers.js';
import { httpError, requireMaster } from '../middleware/auth.js';

export function createGedRouter({service=createGedService({ged:gedStorage,store}),database=store}={}) {
  const router=Router();
  router.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});if(req.method==='POST'){const body=objectBody(req);const allowed=req.path==='/representante'?['empresaId','cpf','name','reference','capacity','validUntil','checked']:['empresaId','cms'];if(Object.keys(body).some(key=>!allowed.includes(key)))throw httpError(400,'O JPGED não recebe certificados privados, senhas ou arquivos enviados pelo navegador.','JPGED_CAMPO_NAO_PERMITIDO');}next();});
  router.use(async(req,res,next)=>{const id=empresaIdFrom(req);if(!id)throw httpError(400,'Selecione uma empresa para acessar o JPGED.','EMPRESA_OBRIGATORIA');const company=await database.get('empresa',id);if(!company)throw httpError(404,'Empresa não encontrada.');if(company.excluidaEm&&req.method==='POST')throw httpError(403,'Esta empresa foi excluída. Novas certificações estão bloqueadas.','EMPRESA_EXCLUIDA');req.gedCompany=company;next();});
  const company=req=>req.gedCompany.id;
  const recent=req=>{if(!req.auth.authTime||Date.now()/1000-req.auth.authTime>600)throw httpError(401,'Para alterar o certificado, saia e entre novamente na conta.','CERTIFICADO_REAUTENTICAR');};
  router.get('/certificado',async(req,res)=>ok(res,{certificate:await service.certificate(company(req))}));
  router.get('/representante',async(req,res)=>ok(res,{representative:await service.representation(company(req))}));
  router.post('/representante',requireMaster,async(req,res)=>{recent(req);ok(res,{representative:await service.authorizeRepresentative(req.gedCompany,req.auth.sub,objectBody(req))});});
  router.post('/representante/revogar',requireMaster,async(req,res)=>{recent(req);await service.revokeRepresentative(company(req),req.auth.sub);ok(res);});
  router.post('/certificado/configurar',async(req,res)=>{recent(req);ok(res,{configuration:await service.configure(req.gedCompany,req.auth.sub)});});
  router.post('/certificado/configurar/:id',async(req,res)=>{recent(req);ok(res,{certificate:await service.confirmConfiguration(req.gedCompany,req.auth.sub,req.params.id,objectBody(req))});});
  router.post('/certificado/desvincular',async(req,res)=>{recent(req);await service.disconnect(company(req),req.auth.sub);ok(res);});
  router.get('/documentos',async(req,res)=>ok(res,await service.documents(company(req),req.query.cursor||'')));
  router.get('/documentos/:id/download',async(req,res)=>ok(res,await service.download(company(req),req.auth.sub,req.params.id)));
  router.post('/fichas/:id/preparar',async(req,res)=>{const ficha=await database.get('ficha',req.params.id);if(!ficha)throw httpError(404,'Ficha não encontrada.');assertRecordAccess(req,ficha);ok(res,await service.prepare(ficha,req.auth.sub));});
  router.get('/assinaturas/:id',async(req,res)=>ok(res,{package:await service.signingPackage(company(req),req.auth.sub,req.params.id)}));
  router.post('/assinaturas/:id',async(req,res)=>ok(res,await service.finish(company(req),req.auth.sub,req.params.id,objectBody(req))));
  return router;
}
export default createGedRouter();
