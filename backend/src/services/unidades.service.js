import {createHash} from 'node:crypto';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {httpError} from '../middleware/auth.js';
const lambda=new LambdaClient({region:process.env.AWS_REGION||'sa-east-1',maxAttempts:1});
const TTL=24*60*60*1000;
const clean=(value,max)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b-\u001f]/.test(value))throw httpError(502,'O cadastro de unidades retornou dados inválidos.','UNIDADES_DADOS');return value.trim();};
const registration=company=>company.inscricaoTipo==='CAEPF'?'':String(company.cnpj||'').replace(/\D/g,'');
export async function lookupTrainingUnits(cnpj){
 const FunctionName=process.env.TRAINING_UNITS_FUNCTION;
 if(!FunctionName)return {ok:true,cnpj,empresa:null,unidades:[],enabled:false};
 const result=await lambda.send(new InvokeCommand({FunctionName,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({jpIntegration:'epi-unidades-v1',cnpj}))}),{abortSignal:AbortSignal.timeout(12000)});
 if(result.FunctionError)throw httpError(503,'Não foi possível consultar o cadastro JP Treinamentos. Tente novamente.','UNIDADES_INDISPONIVEIS');
 let data;try{data=JSON.parse(Buffer.from(result.Payload).toString());}catch{throw httpError(502,'Resposta inválida do cadastro JP Treinamentos.','UNIDADES_DADOS');}
 return data;
}
function cached(company){const data=company._unidadesTreinamentos;return data?.cnpj===registration(company)&&Array.isArray(data.items)?data:null;}
function publicData(data){return {origem:'jp_treinamentos',empresaId:data.empresaId,consultadoEm:data.consultadoEm,version:data.version,items:data.items};}
export function createUnitsService({storage,lookup=lookupTrainingUnits,now=()=>Date.now()}){
 const pending=new Map();
 async function read(companyId,{refresh=false}={}){
  const company=await storage.get('empresa',companyId);
  if(!company||company.excluidaEm)throw httpError(404,'Empresa não encontrada.','EMPRESA_NAO_ENCONTRADA');
  const cnpj=registration(company),old=cached(company);
  if(!/^\d{14}$/.test(cnpj))return {items:[],version:'',origem:'cadastro_empresa',motivo:'Este cadastro não possui CNPJ com 14 dígitos para vincular as unidades.'};
  const age=old?now()-Date.parse(old.consultadoEm):Infinity;
  if(old&&age>=0&&age<(refresh?10000:TTL))return publicData(old);
  if(pending.has(companyId))return pending.get(companyId);
  const task=(async()=>{
   const source=await lookup(cnpj);
   if(!source?.ok||source.cnpj!==cnpj||!Array.isArray(source.unidades)||source.unidades.length>200)throw httpError(502,'Confira o CNPJ e as localidades no JP Treinamentos. Não foi possível vincular este cadastro.','UNIDADES_DADOS');
   if(source.enabled===false)return {items:[],version:'',origem:'cadastro_empresa',motivo:'Integração de unidades não configurada.'};
   if(source.unidades.length&&!source.empresa?.id)throw httpError(502,'Empresa de origem indisponível.','UNIDADES_DADOS');
   const ids=new Set();
   const items=source.unidades.map(unit=>{
    const id=clean(unit.id,128);if(!id||ids.has(id))throw httpError(502,'Identificador de unidade inválido.','UNIDADES_DADOS');ids.add(id);
    const cidade=clean(unit.cidade,120),endereco=clean(unit.endereco,300);let uf=clean(unit.uf||'',2).toUpperCase();
    // Recover only an explicit UF next to this exact city in the central address.
    // Accent differences (Sidrolandia/Sidrolândia) must not discard an existing MS.
    const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const cityPattern=fold(cidade).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(!uf&&cityPattern){const match=new RegExp(cityPattern+'\\s*[-–—,/]\\s*([a-z]{2})(?=\\s*(?:[,;.]|\\d|$))','i').exec(fold(endereco));if(match)uf=match[1].toUpperCase();}
    if(uf&&!new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')).has(uf))throw httpError(502,'UF inválida no cadastro de unidades.','UNIDADES_DADOS');
    return {id,cidade,endereco,uf,cep:clean(unit.cep||'',9)};
   });
   const data={cnpj,empresaId:source.empresa?clean(source.empresa.id,128):'',items,consultadoEm:new Date(now()).toISOString()};
   data.version=createHash('sha256').update(JSON.stringify([data.cnpj,data.empresaId,data.items])).digest('hex');
   try{await storage.update('empresa',companyId,{_unidadesTreinamentos:data},{expectedVersion:company._version,expectedUpdatedAt:company.updatedAt});}
   catch(e){if(e.code!=='REGISTRO_ALTERADO')throw e;throw httpError(409,'O cadastro da empresa mudou durante a consulta. Atualize as unidades novamente.','UNIDADES_EMPRESA_ALTERADA');}
   return publicData(data);
  })();pending.set(companyId,task);try{return await task;}finally{if(pending.get(companyId)===task)pending.delete(companyId);}
 }
 return {read};
}
export function selectCompanyUnit(company,body){
 const data=cached(company),id=body.unidadeId;
 if(!data){
  if(id||process.env.TRAINING_UNITS_FUNCTION&&/^\d{14}$/.test(registration(company)))throw httpError(409,'Carregue as unidades da empresa antes de emitir a ficha.','UNIDADES_CARREGAR');
  return null;
 }
 if(body.unidadeVersao!==data.version)throw httpError(409,'As unidades foram atualizadas. Confira o endereço novamente.','UNIDADES_ALTERADAS');
 if(!data.items.length){if(id)throw httpError(400,'Unidade não pertence à empresa.','UNIDADE_INVALIDA');return null;}
 if(typeof id!=='string'||!id)throw httpError(400,'Selecione a unidade da empresa para esta ficha.','UNIDADE_OBRIGATORIA');
 const unit=data.items.find(x=>x.id===id);
 if(!unit)throw httpError(403,'Unidade não pertence à empresa selecionada.','UNIDADE_INVALIDA');
 if(!unit.endereco||!unit.cidade)throw httpError(409,'Complete o endereço desta unidade no JP Treinamentos e atualize as unidades.','UNIDADE_ENDERECO');
 return {...unit,origem:'jp_treinamentos',empresaId:data.empresaId,version:data.version,consultadoEm:data.consultadoEm};
}
