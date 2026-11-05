import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as storage from '../db/store.js';
import { gedStorage, createGedStorage } from '../db/jpged.js';
import { empresaIdFrom, assertRecordAccess, objectBody, ok, textField } from './_helpers.js';
import { httpError } from '../middleware/auth.js';
import { buildReport } from '../services/relatorios.service.js';
import { reportXlsx, reportPdf, fichasZip } from '../services/relatorios-export.js';
const reportStorage=createGedStorage({bucket:process.env.REPORTS_BUCKET,table:process.env.TABLE_NAME});
export function createReportsRouter(db=storage,ged=gedStorage,files=ged===gedStorage?reportStorage:ged){
  const router=Router();
  router.use((req,res,next)=>{req.reportCompany=empresaIdFrom(req);if(!req.reportCompany)throw httpError(400,'Selecione uma empresa.');next();});
  async function report(req,filters){const id=req.reportCompany;const [empresa,workers,fichas]=await Promise.all([db.get('empresa',id),db.list('trabalhador',id),db.list('ficha',id)]);if(!empresa)throw httpError(404,'Empresa não encontrada.');return buildReport({empresa,workers,fichas,filters,actor:req.auth.sub});}
  router.get('/',async(req,res)=>{const result=await report(req,req.query);const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1)throw httpError(400,'Página inválida.');const total=result.rows.length;ok(res,{...result,rows:result.rows.slice((page-1)*50,page*50),page,pages:Math.max(1,Math.ceil(total/50)),total});});
  router.get('/fichas',async(req,res)=>{const result=await report(req,req.query);ok(res,{items:[...new Map(result.rows.map(r=>[r.fichaId,{id:r.fichaId,numero:r.numero,trabalhadorId:r.trabalhadorId}])).values()],geradoEm:result.geradoEm});});
  async function save(req,bytes,format,extra={}){
    const id=randomUUID(),path=`exports/${req.reportCompany}/${id}.${format}`,filename=`JP_EPI_${format==='zip'?'Fichas':'Relatorio'}_${new Date().toISOString().slice(0,10)}_${id.slice(0,8)}.${format}`;
    const type={pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',zip:'application/zip'}[format];
    await files.saveBlob(path,bytes,type);const item=await db.create('relatorio_export',{empresaId:req.reportCompany,path,filename,actor:req.auth.sub,expiresAtEpoch:Math.floor(Date.now()/1000)+3600,size:bytes.length,...extra});
    await db.create('relatorio_audit',{empresaId:req.reportCompany,actor:req.auth.sub,action:'RELATORIO_GERADO',at:new Date().toISOString(),exportId:item.id,format,...extra});return {id:item.id,filename,size:bytes.length,...extra};
  }
  router.post('/exportar',async(req,res)=>{const body=objectBody(req);if(!['pdf','xlsx'].includes(body.formato))throw httpError(400,'Formato inválido.');const result=await report(req,body.filters||{});if(result.rows.length>10000)throw httpError(413,'Há mais de 10.000 itens. Divida o relatório por período.');const bytes=body.formato==='pdf'?await reportPdf(result):await reportXlsx(result);ok(res,{arquivo:await save(req,bytes,body.formato,{itens:result.rows.length,filters:result.filters})});});
  router.post('/pacote',async(req,res)=>{
    const {ids}=objectBody(req);if(!Array.isArray(ids)||!ids.length||ids.length>25||new Set(ids).size!==ids.length)throw httpError(400,'Selecione de 1 a 25 fichas por parte.');
    const fichas=await Promise.all(ids.map(async id=>{const item=await db.get('ficha',textField(id,{field:'Ficha',required:true,max:128}));if(!item)throw httpError(404,'Ficha não encontrada. Atualize a consulta.');assertRecordAccess(req,item);return item;}));
    const zip=await fichasZip({fichas,ged,empresaId:req.reportCompany});ok(res,{arquivo:await save(req,zip.bytes,'zip',{solicitadas:zip.solicitadas,incluidas:zip.incluidas,pendencias:zip.pendencias})});
  });
  router.get('/arquivos/:id',async(req,res)=>{const file=await db.get('relatorio_export',req.params.id);if(!file||file.empresaId!==req.reportCompany||file.actor!==req.auth.sub)throw httpError(404,'Arquivo não encontrado.');if(file.expiresAtEpoch<=Math.floor(Date.now()/1000))throw httpError(410,'Arquivo expirado. Gere o download novamente.');await db.create('relatorio_audit',{empresaId:req.reportCompany,action:'RELATORIO_BAIXADO',actor:req.auth.sub,exportId:file.id,at:new Date().toISOString()});ok(res,{url:await files.download(file.path,file.filename),filename:file.filename});});
  return router;
}
export default createReportsRouter();
