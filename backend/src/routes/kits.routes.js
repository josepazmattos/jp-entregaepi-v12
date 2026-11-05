import { publicEquipment } from '../services/epis.service.js';
import { reportCatalog } from '../services/epi-report.js';
import { classifyEquipment } from '../services/equipment-classification.js';
import { Router } from 'express';
import * as storage from '../db/store.js';
import { empresaIdFrom, assertRecordAccess, objectBody, textField, ok } from './_helpers.js';
import { httpError } from '../middleware/auth.js';

export function createKitsRouter(db=storage) {
  const router=Router();
  router.use((req,res,next)=>{req.kitCompany=empresaIdFrom(req);if(!req.kitCompany)throw httpError(400,'Selecione uma empresa.');next();});
  router.get('/',async(req,res)=>{
    const items=await db.list('kit',req.kitCompany), ids=[...new Set(items.flatMap(k=>(k.itens||[]).map(i=>i.epiId)))];
    const catalogo=[];
    for(const id of ids){const epi=await db.get('epi',id)||reportCatalog.get(id);if(epi)catalogo.push(publicEquipment(epi));}
    ok(res,{items,catalogo});
  });
  async function values(body) {
    const nome=textField(body.nome,{required:true,field:'Nome da relação',max:160});
    const funcao=textField(body.funcao,{field:'Função de referência',max:300});
    if(!Array.isArray(body.itens)||!body.itens.length||body.itens.length>100)throw httpError(400,'A relação deve ter entre 1 e 100 itens.');
    const itens=[];
    for(const row of body.itens){
      if(!row||typeof row!=='object')throw httpError(400,'Item inválido.');
      const epiId=textField(row.epiId,{required:true,field:'Equipamento',max:128});
      const epi=await db.get('epi',epiId)||reportCatalog.get(epiId);if(!epi)throw httpError(404,'Equipamento não encontrado no catálogo.');
      const quantidade=Number(row.quantidade);
      if(!Number.isSafeInteger(quantidade)||quantidade<1||quantidade>100000)throw httpError(400,'Quantidade inválida.');
      itens.push({epiId,quantidade,...classifyEquipment(epi,row.enquadramento),tamanho:textField(row.tamanho??epi.tamanho,{field:'Tamanho',max:80})});
    }
    return {nome,funcao,itens};
  }
  router.post('/',async(req,res)=>ok(res,{item:await db.create('kit',{...await values(objectBody(req)),empresaId:req.kitCompany,status:'Ativo',criadoPor:req.auth.sub})}));
  router.patch('/:id',async(req,res)=>{
    const item=await db.get('kit',req.params.id);if(!item)throw httpError(404,'Relação não encontrada.');assertRecordAccess(req,item);
    const body=objectBody(req);if(body._version!==item._version)throw httpError(409,'A relação foi alterada. Atualize antes de salvar.');
    let changes=body.nome!=null?await values(body):{};
    if(body.status!=null){if(!['Ativo','Inativo'].includes(body.status))throw httpError(400,'Situação inválida.');changes.status=body.status;}
    if(!Object.keys(changes).length)throw httpError(400,'Informe a alteração.');
    ok(res,{item:await db.update('kit',item.id,{...changes,alteradoPor:req.auth.sub},{expectedVersion:item._version})});
  });
  return router;
}
export default createKitsRouter();
