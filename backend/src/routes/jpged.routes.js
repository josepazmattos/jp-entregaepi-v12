import { Router } from 'express';
import * as store from '../db/store.js';
import { gedStorage } from '../db/jpged.js';
import { createV10Destination } from '../services/v10-destination.js';
import { createGedService } from '../services/jpged.service.js';
import { empresaIdFrom, assertRecordAccess, objectBody, ok } from './_helpers.js';
import { httpError, requireMaster } from '../middleware/auth.js';
import { bearer } from '../security/session.js';
import { invokeSecurity } from '../security/remote.js';

export function createGedRouter({service=createGedService({ged:gedStorage,store}),database=store,v10=createV10Destination({ged:gedStorage})}={}) {
  const router=Router();
  router.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});if(req.method==='POST'){const body=objectBody(req);const allowed=req.path==='/v10/destino'?['empresaId','destinationId','version']:req.path.startsWith('/cofre/')?['empresaId','chain','signature','wrappedKey']:['empresaId','cms'];if(Object.keys(body).some(key=>!allowed.includes(key)))throw httpError(400,'O JPGED não recebe certificados privados, senhas ou arquivos enviados pelo navegador.','JPGED_CAMPO_NAO_PERMITIDO');}next();});
  router.use(async(req,res,next)=>{const id=empresaIdFrom(req);if(!id)throw httpError(400,'Selecione uma empresa para acessar o JPGED.','EMPRESA_OBRIGATORIA');const company=await database.get('empresa',id);if(!company)throw httpError(404,'Empresa não encontrada.');if(company.excluidaEm&&req.method==='POST')throw httpError(403,'Esta empresa foi excluída. Novas certificações estão bloqueadas.','EMPRESA_EXCLUIDA');req.gedCompany=company;next();});
  const company=req=>req.gedCompany.id;
  router.use(async(req,res,next)=>{
    if (!process.env.SIGNER_FUNCTION || !process.env.VAULT_ADMIN_FUNCTION) return next();
    const call=(target,action,extra={})=>invokeSecurity(target,{action,token:bearer(req.headers),company:company(req),...extra});
    if(req.method==='GET'&&req.path==='/certificado')return ok(res,{certificate:await call(process.env.SIGNER_FUNCTION,'certificate')});
    let match;
    if(req.method==='GET'&&(match=/^\/documentos\/([A-Za-z0-9_-]+)\/download$/.exec(req.path))){
      if(req.query.versao&&req.query.versao!=='original')throw httpError(400,'Versão de impressão inválida.','JPGED_VERSAO');
      return ok(res,await call(process.env.SIGNER_FUNCTION,'download',{id:match[1],original:req.query.versao==='original'}));
    }
    if(req.method!=='POST')return next();
    if((match=/^\/fichas\/([A-Za-z0-9_-]+)\/preparar$/.exec(req.path)))return ok(res,await call(process.env.SIGNER_FUNCTION,'prepare',{id:match[1]}));
    if((match=/^\/assinaturas\/([A-Za-z0-9_-]+)\/certificar$/.exec(req.path)))return ok(res,await call(process.env.SIGNER_FUNCTION,'certify',{id:match[1]}));
    if((match=/^\/documentos\/([A-Za-z0-9_-]+)\/atualizar-layout$/.exec(req.path)))return ok(res,await call(process.env.SIGNER_FUNCTION,'layout',{id:match[1]}));
    if(req.path==='/certificado/desvincular'){await call(process.env.VAULT_ADMIN_FUNCTION,'disconnect');return ok(res);}
    const {empresaId,...body}=objectBody(req);
    if(req.path==='/v10/destino')return ok(res,await call(process.env.VAULT_ADMIN_FUNCTION,'destination',{body}));
    if(req.path==='/cofre/preparar')return ok(res,{configuration:await call(process.env.VAULT_ADMIN_FUNCTION,'start',{body})});
    if((match=/^\/cofre\/([A-Za-z0-9_-]+)\/(comprovar|concluir|cancelar)$/.exec(req.path))){
      const action={comprovar:'prove',concluir:'complete',cancelar:'cancel'}[match[2]];
      const result=await call(process.env.VAULT_ADMIN_FUNCTION,action,{id:match[1],body});
      return ok(res,result);
    }
    // All active certificates use KMS. Legacy local configuration/signing may
    // not bypass the isolated services or restore shared key administration.
    if(req.path.startsWith('/certificado/configurar')||/^\/assinaturas\/[^/]+$/.test(req.path))throw httpError(410,'Utilize a instalação e a assinatura pelo cofre.','COFRE_FLUXO_OBRIGATORIO');
    next();
  });
  const recent=req=>{if(!req.auth.authTime||Date.now()/1000-req.auth.authTime>600)throw httpError(401,'Para alterar o certificado, saia e entre novamente na conta.','CERTIFICADO_REAUTENTICAR');};
  router.get('/certificado',async(req,res)=>ok(res,{certificate:await service.certificate(company(req))}));
  router.post('/certificado/configurar',requireMaster,async(req,res)=>{recent(req);ok(res,{configuration:await service.configure(req.gedCompany,req.auth.sub)});});
  router.post('/certificado/configurar/:id',requireMaster,async(req,res)=>{recent(req);ok(res,{certificate:await service.confirmConfiguration(req.gedCompany,req.auth.sub,req.params.id,objectBody(req))});});
  router.post('/certificado/desvincular',requireMaster,async(req,res)=>{recent(req);await service.disconnect(company(req),req.auth.sub);ok(res);});
  router.post('/cofre/preparar',requireMaster,async(req,res)=>{recent(req);ok(res,{configuration:await service.vaultAdmin.start(req.gedCompany,req.auth.sub,objectBody(req))});});
  router.post('/cofre/:id/comprovar',requireMaster,async(req,res)=>{recent(req);ok(res,await service.vaultAdmin.prove(req.gedCompany,req.auth.sub,req.params.id,objectBody(req)));});
  router.post('/cofre/:id/cancelar',requireMaster,async(req,res)=>{recent(req);await service.vaultAdmin.cancel(req.gedCompany,req.auth.sub,req.params.id);ok(res);});
  router.post('/cofre/:id/concluir',requireMaster,async(req,res)=>{recent(req);await service.vaultAdmin.complete(req.gedCompany,req.auth.sub,req.params.id,objectBody(req));ok(res,{certificate:await service.certificate(company(req))});});
  router.post('/assinaturas/:id/certificar',async(req,res)=>ok(res,await service.certify(company(req),req.auth.sub,req.params.id)));
  router.get('/v10/destino',requireMaster,async(req,res)=>ok(res,await v10.status(req.gedCompany)));
  router.get('/v10/destinos',requireMaster,async(req,res)=>ok(res,await v10.search(req.gedCompany,req.query.q||'')));
  router.post('/v10/destino',requireMaster,async(req,res)=>ok(res,await v10.save(req.gedCompany,req.auth.sub,objectBody(req))));
  router.get('/documentos',async(req,res)=>ok(res,await service.documents(company(req),req.query.cursor||'')));
  router.get('/documentos/:id/download',async(req,res)=>{if(req.query.versao&&req.query.versao!=='original')throw httpError(400,'Versão de impressão inválida.','JPGED_VERSAO');ok(res,await service.download(company(req),req.auth.sub,req.params.id,{original:req.query.versao==='original'}));});
  router.post('/documentos/:id/atualizar-layout',async(req,res)=>ok(res,await service.reissueLayout(company(req),req.auth.sub,req.params.id)));
  router.post('/fichas/:id/preparar',async(req,res)=>{const ficha=await database.get('ficha',req.params.id);if(!ficha)throw httpError(404,'Ficha não encontrada.');assertRecordAccess(req,ficha);ok(res,await service.prepare(ficha,req.auth.sub));});
  router.get('/assinaturas/:id',async(req,res)=>ok(res,{package:await service.signingPackage(company(req),req.auth.sub,req.params.id)}));
  router.post('/assinaturas/:id',async(req,res)=>ok(res,await service.finish(company(req),req.auth.sub,req.params.id,objectBody(req))));
  return router;
}
export default createGedRouter();
