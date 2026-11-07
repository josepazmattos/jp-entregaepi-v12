// One-off IAM-only initialization of locality caches for existing EPI companies.
import * as storage from './src/db/store.js';
import {createUnitsService} from './src/services/unidades.service.js';
export async function handler(event){
 if(process.env.AWS_LAMBDA_FUNCTION_NAME!=='jp-entregaepi-unidades-maintenance-20261107'||!['inspect','apply'].includes(event?.action))throw new Error('MAINTENANCE_SCOPE');
 const companies=(await storage.listForDisplay('empresa')).filter(c=>!c.excluidaEm);
 if(companies.length>300)throw new Error('MAINTENANCE_COMPANY_LIMIT');
 const service=createUnitsService({storage}),results=[];
 for(let offset=0;offset<companies.length;offset+=3){
  await Promise.all(companies.slice(offset,offset+3).map(async c=>{
   if(event.action==='inspect'){results.push({id:c.id,cnpj:c.cnpj,tipo:c.inscricaoTipo||'CNPJ',cached:!!c._unidadesTreinamentos});return;}
   try{const data=await service.read(c.id);results.push({id:c.id,nome:c.nome,cnpj:c.cnpj,empresaTreinamentosId:data.empresaId||'',unidades:data.items.length,consultadoEm:data.consultadoEm||'',motivo:data.motivo||''});}
   catch(e){results.push({id:c.id,nome:c.nome,cnpj:c.cnpj,error:e.code||e.name,message:e.message});}
  }));
 }
 return {action:event.action,total:companies.length,results};
}
