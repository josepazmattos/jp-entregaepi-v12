import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {httpError} from '../middleware/auth.js';
const lambda=new LambdaClient({region:process.env.AWS_REGION||'sa-east-1',maxAttempts:2,requestHandler:{connectionTimeout:2000,requestTimeout:10000}});
const fail=(status,message,code='V10_DESTINO')=>{throw httpError(status,message,code);};
const cnpj=company=>{if((company.inscricaoTipo||'CNPJ')!=='CNPJ')fail(409,'Este cadastro não utiliza CNPJ.');const value=String(company.cnpj||'').toUpperCase().replace(/[.\/\-\s]/g,'');if(!/^[A-Z0-9]{12}\d{2}$/.test(value))fail(409,'Confira o CNPJ da empresa.');return value;};
export async function invokeV10(event){
 const r=await lambda.send(new InvokeCommand({FunctionName:process.env.V10_RESOLVER||'jp-v10-empresas-r44',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(event))}));
 if(r.FunctionError)fail(503,'Não foi possível consultar o V10. Tente novamente.');
 return JSON.parse(Buffer.from(r.Payload).toString());
}
export function createV10Destination({ged,invoke=invokeV10,now=()=>new Date().toISOString()}){
 const enabled=()=>{if(process.env.V10_SYNC_ENABLED!=='true')fail(503,'Integração temporariamente indisponível.');};
 async function context(company){enabled();const sourceCnpj=cnpj(company);const automatic=await invoke({op:'jpged_v10_destino',cnpj:sourceCnpj});const mapping=await ged.get(company.id,'V10DEST','current');return {sourceCnpj,automatic,mapping};}
 async function status(company){const {sourceCnpj,automatic,mapping}=await context(company);if(automatic.ok)return {mode:'automatic',eligible:false};if(automatic.code!=='V10_EMPRESA_NAO_ENCONTRADA')return {mode:'blocked',eligible:false,message:'O vínculo da empresa precisa ser conferido no V10.'};return {mode:mapping?'manual':'missing',eligible:true,version:mapping?.version||0,...(mapping?{selected:{id:mapping.destinationId,nome:mapping.name,pasta:mapping.prefix},stale:mapping.sourceCnpj!==sourceCnpj}:{})};}
 async function search(company,q){const s=await status(company);if(!s.eligible)fail(409,'Esta empresa já utiliza a correspondência automática por CNPJ.');if(typeof q!=='string'||q.length>100)fail(400,'Busca inválida.');return invoke({op:'jpged_v10_destinos',q});}
 async function save(company,actor,body){
  if(!Number.isSafeInteger(body.destinationId)||body.destinationId<1||!Number.isSafeInteger(body.version)||body.version<0)fail(400,'Selecione uma empresa da lista de destinos.');
  const {sourceCnpj,automatic,mapping}=await context(company);
  if(automatic.ok||automatic.code!=='V10_EMPRESA_NAO_ENCONTRADA')fail(409,'A correspondência por CNPJ mudou. Atualize a página.');
  if((mapping?.version||0)!==body.version)fail(409,'O destino foi alterado. Atualize a página.');
  const target=await invoke({op:'jpged_v10_destino',cnpj:sourceCnpj,destinoId:body.destinationId});
  if(!target.ok||target.mode!=='manual'||target.empresaId!==body.destinationId)fail(409,'O destino selecionado não está disponível. Atualize a busca.');
  const data={sourceCnpj,destinationId:target.empresaId,destinationCnpj:target.destinationCnpj,name:target.nome,prefix:target.prefix,bucket:target.bucket,linkedBy:actor,linkedAt:now()};
  // Preserve the preceding link as audit data before an explicit change.
  if(mapping)await ged.put(company.id,'AUDIT','v10-destino-'+mapping.version,{action:'V10_DESTINO_ANTERIOR',at:now(),actor,mapping},0).catch(e=>{if(e.code!=='JPGED_CONFLICT')throw e;});
  await ged.put(company.id,'V10DEST','current',data,body.version);
  return {saved:true,message:'Destino salvo. As fichas pendentes serão enviadas automaticamente.'};
 }
 return {status,search,save};
}
