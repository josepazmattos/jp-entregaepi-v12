import {createHash} from 'node:crypto';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {httpError} from '../middleware/auth.js';
const lambda=new LambdaClient({region:process.env.AWS_REGION||'sa-east-1',maxAttempts:1});
const TTL=24*60*60*1000;
const clean=(value,max)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b-\u001f]/.test(value))throw httpError(502,'O cadastro de unidades retornou dados inválidos.','UNIDADES_DADOS');return value.trim();};
const registration=company=>company.inscricaoTipo==='CAEPF'?'':String(company.cnpj||'').replace(/\D/g,'');
async function invokeTraining(payload){
 const FunctionName=process.env.TRAINING_UNITS_FUNCTION;
 if(!FunctionName)throw httpError(503,'Integração de localidades não configurada.','UNIDADES_INDISPONIVEIS');
 const result=await lambda.send(new InvokeCommand({FunctionName,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(payload))}),{abortSignal:AbortSignal.timeout(12000)});
 if(result.FunctionError)throw httpError(503,'Não foi possível consultar o cadastro JP Treinamentos. Tente novamente.','UNIDADES_INDISPONIVEIS');
 let data;try{data=JSON.parse(Buffer.from(result.Payload).toString());}catch{throw httpError(502,'Resposta inválida do cadastro JP Treinamentos.','UNIDADES_DADOS');}
 return data;
}
export async function lookupTrainingUnits(cnpj){
 if(!process.env.TRAINING_UNITS_FUNCTION)return {ok:true,cnpj,empresa:null,unidades:[],enabled:false};
 return invokeTraining({jpIntegration:'epi-unidades-v1',cnpj});
}
export const saveTrainingUnits=input=>invokeTraining({jpIntegration:'epi-unidades-cadastro-v1',...input});
export function validateUnitChanges(changes){
 if(!Array.isArray(changes)||!changes.length||changes.length>200)throw httpError(400,'Informe entre 1 e 200 localidades por gravação.','UNIDADES_LOTE');
 const ids=new Set();
 for(const u of changes){
  if(!u||typeof u!=='object'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(u.id))||ids.has(u.id)||typeof u.ativo!=='boolean'||u.revisao!=null&&!/^[a-f0-9]{64}$/.test(u.revisao))throw httpError(400,'Identificador de unidade inválido. Reabra o cadastro.','UNIDADE_INVALIDA');
  ids.add(u.id);
  if(!u.ativo&&!u.revisao)throw httpError(400,'Reabra a unidade antes de inativar.','UNIDADE_REVISAO');
  if(u.ativo){
   for(const [key,min,max] of [['cidade',2,120],['endereco',5,300]])if(typeof u[key]!=='string'||u[key].trim().length<min||u[key].length>max||/[\u0000-\u001f]/.test(u[key]))throw httpError(400,'Preencha a localidade e o endereço completo de cada unidade.','UNIDADE_ENDERECO');
   if(typeof u.uf!=='string'||u.uf&&!('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(u.uf)))throw httpError(400,'Informe uma UF válida.','UNIDADE_UF');
   if(typeof u.cep!=='string'||u.cep&&!/^\d{5}-?\d{3}$/.test(u.cep))throw httpError(400,'Informe o CEP com 8 dígitos.','UNIDADE_CEP');
  }
 }
 return changes.map(u=>({id:u.id,ativo:u.ativo,revisao:u.revisao||null,...(u.ativo?{cidade:u.cidade.trim(),endereco:u.endereco.trim(),uf:u.uf,cep:u.cep}: {})}));
}

function cached(company){const data=company._unidadesTreinamentos;return data?.cnpj===registration(company)&&Array.isArray(data.items)?data:null;}
function publicData(data){return {origem:'jp_treinamentos',empresaId:data.empresaId,consultadoEm:data.consultadoEm,version:data.version,items:data.items};}
export function createUnitsService({storage,lookup=lookupTrainingUnits,save=saveTrainingUnits,now=()=>Date.now()}){
 const pending=new Map();
 async function read(companyId,{refresh=false,force=false}={}){
  const company=await storage.get('empresa',companyId);
  if(!company||company.excluidaEm)throw httpError(404,'Empresa não encontrada.','EMPRESA_NAO_ENCONTRADA');
  const cnpj=registration(company),old=cached(company);
  if(!/^\d{14}$/.test(cnpj))return {items:[],version:'',origem:'cadastro_empresa',motivo:'Este cadastro não possui CNPJ com 14 dígitos para vincular as unidades.'};
  const age=old?now()-Date.parse(old.consultadoEm):Infinity;
  if(!force&&old&&age>=0&&age<(refresh?10000:TTL))return publicData(old);
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
    return {id,...(unit.revisao?{revisao:clean(unit.revisao,64)}:{}),cidade,endereco,uf,cep:clean(unit.cep||'',9)};
   });
   const data={cnpj,empresaId:source.empresa?clean(source.empresa.id,128):'',items,consultadoEm:new Date(now()).toISOString()};
   data.version=createHash('sha256').update(JSON.stringify([data.cnpj,data.empresaId,data.items])).digest('hex');
   try{await storage.update('empresa',companyId,{_unidadesTreinamentos:data},{expectedVersion:company._version,expectedUpdatedAt:company.updatedAt});}
   catch(e){if(e.code!=='REGISTRO_ALTERADO')throw e;throw httpError(409,'O cadastro da empresa mudou durante a consulta. Atualize as unidades novamente.','UNIDADES_EMPRESA_ALTERADA');}
   return publicData(data);
  })();pending.set(companyId,task);try{return await task;}finally{if(pending.get(companyId)===task)pending.delete(companyId);}
 }
 async function write(companyId,changes,actor){
  const alteracoes=validateUnitChanges(changes);
  if(pending.has(companyId))await pending.get(companyId);
  const company=await storage.get('empresa',companyId);
  if(!company||company.excluidaEm)throw httpError(404,'Empresa não encontrada.','EMPRESA_NAO_ENCONTRADA');
  const cnpj=registration(company);
  if(!/^\d{14}$/.test(cnpj))throw httpError(400,'As localidades compartilhadas exigem CNPJ com 14 dígitos.','UNIDADES_CNPJ_INVALIDO');
  // Invalidate before the remote write: a lost response cannot leave old addresses eligible.
  await storage.update('empresa',companyId,{_unidadesTreinamentos:null},{expectedVersion:company._version,expectedUpdatedAt:company.updatedAt});
  const result=await save({cnpj,nome:company.nome,actor,alteracoes});
  if(!result?.ok||result.cnpj!==cnpj)throw httpError([400,403,404,409].includes(result?.status)?result.status:503,result?.message||'Não foi possível salvar as localidades. Tente novamente; os identificadores serão preservados.',result?.code||'UNIDADES_INDISPONIVEIS');
  return read(companyId,{force:true});
 }
 return {read,write};
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
