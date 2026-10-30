import {httpError} from '../middleware/auth.js';
import {sha256,canonical} from './document-integrity.js';
const fail=(code,message,status=400)=>{throw httpError(status,message,code);};
const scope='facial-control',entity='facial_config',id='global';
export function facialInfrastructureReady(env=process.env){
 try{return ['FACIAL_BUCKET','FACIAL_STREAM_ROLE_ARN','FACIAL_ATTESTATION_KEY_ARN','FACIAL_QUOTA_TABLE','FACIAL_ACCOUNT_ID'].every(k=>Boolean(env[k]))&&Boolean(JSON.parse(env.FACIAL_TRUSTED_KEYS||'{}')[env.FACIAL_ATTESTATION_KEY_ARN]);}catch{return false;}
}
export function createFacialControl({store,provider,ready=facialInfrastructureReady,clock=()=>Date.now()}){
 async function record(){return await store.get(entity,id)||{enabled:false,endAt:null,totalLimit:50,dailyLimit:20,_version:0};}
 async function privacy(){
  if(!ready())return {ready:false,reason:'SETUP_PENDING'};
  try{return {ready:await provider.privacyReady(),checkedAt:new Date(clock()).toISOString()};}catch{return {ready:false,reason:'PRIVACY_UNCONFIRMED',checkedAt:new Date(clock()).toISOString()};}
 }
 async function settings(){const config=await record();return {enabled:config.enabled&&ready(),privacyReady:config.enabled?(await privacy()).ready:false,endAt:config.endAt,limits:{total:config.totalLimit,daily:config.dailyLimit},version:config._version};}
 async function view(){
  const [config,check]=await Promise.all([record(),privacy()]);
  let usage=null;try{if(ready())usage=await provider.quotaUsage();}catch{/* Config remains visible when the quota service is unavailable. */}
  return {config:{enabled:config.enabled,endAt:config.endAt,totalLimit:config.totalLimit,dailyLimit:config.dailyLimit,version:config._version,updatedAt:config.updatedAt||null},infrastructureReady:ready(),privacy:check,usage,remaining:usage?Math.max(0,config.totalLimit-usage.total):null,active:Boolean(config.enabled&&check.ready&&Date.parse(config.endAt)>clock()&&usage&&usage.total<config.totalLimit)};
 }
 async function update({actor,body}){
  if(typeof body.enabled!=='boolean'||!Number.isInteger(body.version)||body.version<0||typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(body.requestId))fail('FACIAL_CONFIG_INVALIDA','Atualize o painel e confira as opções.');
  const mutationId='settings:'+sha256(actor+'\n'+body.requestId),requestHash=sha256(JSON.stringify(canonical(body))),receipt=await store.getReceipt(scope,mutationId);
  if(receipt){if(receipt.result?.requestHash!==requestHash)fail('FACIAL_CONFIG_REUTILIZADA','Esta solicitação já foi utilizada com outras opções.',409);return view();}
  const previous=await record();if(previous._version!==body.version)fail('REGISTRO_ALTERADO','As opções mudaram em outra sessão. Atualize o painel.',409);
  let patch={enabled:body.enabled,changedBy:actor};
  if(body.enabled){
   if(!ready())fail('FACIAL_SETUP_PENDENTE','A configuração inicial da AWS ainda não foi concluída.',409);
   if(!(await privacy()).ready)fail('FACIAL_PRIVACIDADE_PENDENTE','A exclusão de uso das capturas para melhoria da IA ainda não pôde ser confirmada na AWS.',409);
   const end=Date.parse(body.endAt);
   if(!Number.isFinite(end)||end<=clock()||end>clock()+366*86400000)fail('FACIAL_PRAZO_INVALIDO','Escolha uma validade futura de até um ano.');
   if(!Number.isInteger(body.remainingLimit)||body.remainingLimit<1||body.remainingLimit>10000||!Number.isInteger(body.dailyLimit)||body.dailyLimit<1||body.dailyLimit>1000)fail('FACIAL_LIMITE_INVALIDO','Informe entre 1 e 10.000 capturas restantes e entre 1 e 1.000 por operador/dia.');
   if(body.acknowledgeCosts!==true||body.acknowledgeGovernance!==true)fail('FACIAL_CONFIG_ACEITE','Confirme o custo por uso e as responsabilidades sobre os dados.');
   const usage=await provider.quotaUsage();
   patch={...patch,endAt:new Date(end).toISOString(),totalLimit:usage.total+body.remainingLimit,dailyLimit:body.dailyLimit,governanceConfirmedBy:actor,governanceConfirmedAt:new Date(clock()).toISOString(),costsAcknowledged:true};
  }
  const operations=[{type:previous._version?'update':'create',entity,id,...(previous._version?{expectedVersion:previous._version}:{}),data:{...(!previous._version?{endAt:null,totalLimit:50,dailyLimit:20}:{}),...patch}},{type:'create',entity:'facial_config_audit',id:mutationId,data:{actor,at:new Date(clock()).toISOString(),before:{enabled:previous.enabled,endAt:previous.endAt,totalLimit:previous.totalLimit,dailyLimit:previous.dailyLimit},after:patch,requestHash}}];
  await store.transact({scope,expectedRevision:await store.readScope(scope),mutationId,operations,result:{requestHash}});
  return view();
 }
 return {view,update,settings};
}
