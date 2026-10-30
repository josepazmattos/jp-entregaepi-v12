import {randomUUID} from 'node:crypto';
import {httpError} from '../middleware/auth.js';
import {documentHash,sha256,canonical} from './document-integrity.js';
import {signaturePending} from './biometria.service.js';
import {acceptanceFor} from './assinatura-termo.js';
import {FACIAL_METHOD,FACIAL_NOTICE_ID,FACIAL_POLICY} from './facial-proof.js';
import {workerScope} from './trabalhadores-import.service.js';

const fail=(code,message,status=409)=>{throw httpError(status,message,code);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const facialSettings=()=>({enabled:process.env.FACIAL_ENABLED==='true',privacyReady:process.env.FACIAL_PRIVACY_READY==='true',endAt:process.env.FACIAL_PILOT_END});
export function createFacialService({store,provider,settings=facialSettings,clock=()=>Date.now()}){
  const at=()=>new Date(clock()).toISOString();
  const status=()=>{const s=settings();return {enabled:s.enabled&&s.privacyReady&&Number.isFinite(Date.parse(s.endAt))&&clock()<Date.parse(s.endAt),endAt:s.endAt||null,noticeId:FACIAL_NOTICE_ID};};
  const active=()=>{if(!status().enabled)fail('FACIAL_INDISPONIVEL','A assinatura facial não está liberada nesta etapa. A assinatura digital continua disponível.',403);};
  async function commit(scope,id,operations){
    for(let attempt=0;;attempt++){
      const revision=await store.readScope(scope);
      try{return await store.transact({scope,expectedRevision:revision,mutationId:id,operations});}
      catch(error){if(error.code!=='REGISTRO_ALTERADO'||attempt>=4)throw error;
        for(const op of operations){const current=await store.get(op.entity,op.id);if(op.type==='create'?!!current:!current||current._version!==op.expectedVersion)throw error;}
      }
    }
  }
  async function enrollment(worker){
    const id=worker.biometriaFacial?.id,record=id?await store.get('facial_cadastro',id):null;
    if(!record||record.empresaId!==worker.empresaId||record.trabalhadorId!==worker.id||record.status!=='ativo'||record.cpf!==String(worker.cpf||'').replace(/\D/g,''))fail('FACIAL_CADASTRO_PENDENTE','Cadastre o rosto deste trabalhador antes de assinar a ficha.');
    return record;
  }
  async function info(worker){
    let record;try{record=await enrollment(worker);}catch(error){if(error.code!=='FACIAL_CADASTRO_PENDENTE')throw error;}
    return {...status(),enrollment:record?{id:record.id,enrolledAt:record.enrolledAt,operator:record.actor}:null};
  }
  async function begin({worker,ficha=null,actor,body,kind}){
    active();
    if(!uuid(body.requestId)||!['enroll','verify'].includes(kind))fail('FACIAL_SOLICITACAO_INVALIDA','Inicie uma nova captura.',400);
    if(body.noticeId!==FACIAL_NOTICE_ID||body.cienciaDados!==true)fail('FACIAL_AVISO_OBRIGATORIO','Leia o aviso de privacidade antes da captura.',400);
    if(worker.status==='Inativo'&&!(kind==='verify'&&ficha?.tipo==='Devolução'))fail('TRABALHADOR_INATIVO','O trabalhador está inativo.');
    let source=null,acceptance=null;
    if(kind==='verify'){
      if(!ficha||!signaturePending(ficha)||ficha.empresaId!==worker.empresaId||ficha.trabalhadorId!==worker.id)fail('FICHA_NAO_PENDENTE','Gere e confira a ficha antes de assiná-la.');
      if(!ficha.modeloFicha?.termoAssinatura)fail('FACIAL_MODELO_ANTERIOR','Esta ficha foi emitida antes do termo de assinatura facial. Use a digital ou emita uma nova ficha.');
      acceptance=acceptanceFor(ficha,body,actor,'FACIAL',at());source=await enrollment(worker);
    }else if(body.identidadeConferida!==true)fail('FACIAL_IDENTIDADE_OBRIGATORIA','Confira a identidade do trabalhador antes do cadastro facial.',400);
    const request={kind,workerId:worker.id,companyId:worker.empresaId,workerVersion:worker._version,fichaId:ficha?.id||'',fichaVersion:ficha?._version||0,documentHash:ficha?documentHash(ficha):'',enrollmentId:source?.id||'',enrollmentHash:source?.referenceHash||'',noticeId:FACIAL_NOTICE_ID,aceiteTermo:Boolean(acceptance)};
    const requestHash=sha256(JSON.stringify(canonical(request))),id=sha256(actor+'\n'+body.requestId);
    let challenge=await store.get('facial_desafio',id);
    if(challenge){
      if(challenge.actor!==actor||challenge.requestHash!==requestHash||challenge.state!=='READY'||challenge.sessionExpiresAt<=clock())fail('FACIAL_TENTATIVA_USADA','A tentativa mudou, expirou ou já foi usada. Inicie novamente.');
    }else{
      await commit('facial-captures',`start:${id}`,[{type:'create',entity:'facial_desafio',id,data:{empresaId:worker.empresaId,trabalhadorId:worker.id,actor,request,requestHash,acceptance,state:'CREATING',expiresAtEpoch:Math.floor(clock()/1000)+7*86400}}]);
      challenge=await store.get('facial_desafio',id);
      try{
        await provider.reserveQuota(actor,id);
        const session=await provider.create({token:id});
        if(!uuid(session.sessionId))throw Error('Missing provider session');
        challenge=await store.update('facial_desafio',id,{state:'READY',sessionId:session.sessionId,providerRequestId:session.requestId||null,sessionExpiresAt:clock()+175000},{expectedVersion:challenge._version});
      }catch(error){await store.update('facial_desafio',id,{state:'FAILED'},{expectedVersion:challenge._version}).catch(()=>{});throw error;}
    }
    const credentials=await provider.credentials(id.slice(0,48));
    return {attemptId:id,sessionId:challenge.sessionId,region:'sa-east-1',credentials,expiresAt:challenge.sessionExpiresAt,documentHash:request.documentHash};
  }
  async function ownAttempt({worker,ficha,actor,body,kind}){
    if(typeof body.attemptId!=='string'||!/^[a-f0-9]{64}$/.test(body.attemptId))fail('FACIAL_TENTATIVA_INVALIDA','Tentativa facial inválida.',400);
    const item=await store.get('facial_desafio',body.attemptId);
    if(!item||item.empresaId!==worker.empresaId||item.trabalhadorId!==worker.id||item.actor!==actor||item.request.kind!==kind||item.request.fichaId!==(ficha?.id||''))fail('FACIAL_TENTATIVA_INVALIDA','Esta captura não pertence ao trabalhador e à ficha selecionados.',403);
    return item;
  }
  async function complete(args){
    const {worker,ficha=null,actor,kind}=args;
    let challenge=await ownAttempt(args);
    if(challenge.state==='APPROVED'){
      const item=await store.get(kind==='verify'?'ficha':'trabalhador',kind==='verify'?ficha.id:worker.id);
      return {approved:true,item,replayed:true};
    }
    if(challenge.state!=='READY'||challenge.sessionExpiresAt<=clock())fail('FACIAL_TENTATIVA_USADA','A tentativa expirou ou já foi encerrada.');
    const original=challenge.request;
    if(original.workerVersion!==worker._version||ficha&&(original.fichaVersion!==ficha._version||original.documentHash!==documentHash(ficha)||!signaturePending(ficha)))fail('REGISTRO_ALTERADO','A ficha ou o cadastro mudou durante a captura. Inicie novamente.');
    challenge=await store.update('facial_desafio',challenge.id,{state:'PROCESSING'},{expectedVersion:challenge._version});
    let image,committed=false;
    try{
      const live=await provider.result(challenge.sessionId);
      if(['CREATED','IN_PROGRESS'].includes(live.status)){await store.update('facial_desafio',challenge.id,{state:'READY'},{expectedVersion:challenge._version});return {pending:true};}
      if(live.status!=='SUCCEEDED'||!Number.isFinite(live.confidence)||live.confidence<FACIAL_POLICY.liveness||!live.image?.length)fail('FACIAL_PROVA_VIDA_REPROVADA','A prova de vida não foi confirmada. Ajuste a iluminação e inicie outra tentativa.',422);
      if(await provider.countFaces(live.image)!==1)fail('FACIAL_ROSTO_UNICO','Somente o trabalhador deve aparecer na captura.',422);
      let source=null,comparison=null;
      if(kind==='verify'){
        source=await enrollment(worker);
        if(source.id!==original.enrollmentId||source.referenceHash!==original.enrollmentHash)fail('REGISTRO_ALTERADO','O cadastro facial foi alterado. Inicie novamente.');
        const reference=await provider.getImage(source.image.key,source.image.version);
        if(sha256(reference)!==source.referenceHash)fail('FACIAL_REFERENCIA_INVALIDA','Não foi possível confirmar a integridade do cadastro facial.');
        comparison=await provider.compare(reference,live.image);
        if(comparison.faceCount!==1||!Number.isFinite(comparison.similarity)||comparison.similarity<FACIAL_POLICY.similarity)fail('FACIAL_DIVERGENTE','O rosto não corresponde ao cadastro deste trabalhador. A ficha continua sem assinatura.',422);
      }
      image=await provider.putImage(worker.empresaId,challenge.id,live.image);
      const id=randomUUID(),signedAt=at(),proof=JSON.stringify(canonical({v:1,method:FACIAL_METHOD,kind,companyId:worker.empresaId,workerId:worker.id,fichaId:ficha?.id||'',documentHash:original.documentHash,enrollmentId:source?.id||id,referenceHash:source?.referenceHash||sha256(live.image),imageHash:sha256(live.image),matched:kind==='verify',sessionId:challenge.sessionId,sessionStatus:live.status,liveness:live.confidence,similarity:comparison?.similarity??null,faceCount:1,policy:FACIAL_POLICY,challenge:live.challenge||null,createRequestId:challenge.providerRequestId,resultRequestId:live.requestId||null,comparisonRequestId:comparison?.requestId||null,acceptance:challenge.acceptance,noticeId:FACIAL_NOTICE_ID,signedAt,actor}));
      const seal=await provider.sign(proof);
      const evidence={proof,...seal},operations=[];
      if(kind==='enroll'){
        const old=worker.biometriaFacial?.id?await store.get('facial_cadastro',worker.biometriaFacial.id):null;
        operations.push({type:'create',entity:'facial_cadastro',id,data:{empresaId:worker.empresaId,trabalhadorId:worker.id,cpf:String(worker.cpf||'').replace(/\D/g,''),status:'ativo',referenceHash:sha256(live.image),image,enrolledAt:signedAt,actor,identityChecked:true,...evidence}});
        operations.push({type:'update',entity:'trabalhador',id:worker.id,expectedVersion:worker._version,data:{biometriaFacial:{id,enrolledAt:signedAt}}});
        if(old)operations.push({type:'update',entity:'facial_cadastro',id:old.id,expectedVersion:old._version,data:{status:'substituido',substituidoEm:signedAt}});
      }else{
        if(ficha.assinaturaBiometrica)operations.push({type:'create',entity:'assinatura_anterior',id:randomUUID(),data:{empresaId:worker.empresaId,fichaId:ficha.id,assinaturaBiometrica:ficha.assinaturaBiometrica,substituidaEm:signedAt,substituidaPor:actor}});
        operations.push({type:'update',entity:'ficha',id:ficha.id,expectedVersion:ficha._version,data:{status:'assinada',assinaturaStatus:'verificada',dataAssinatura:signedAt,assinaturaBiometrica:{id,metodo:FACIAL_METHOD,verificada:true,signedAt,capturadoPor:actor,aceiteTermo:challenge.acceptance,challengeId:challenge.id,...evidence}}});
        operations.push({type:'create',entity:'facial_evidencia',id,data:{empresaId:worker.empresaId,trabalhadorId:worker.id,fichaId:ficha.id,referenceImage:source.image,captureImage:image,...evidence}});
        operations.push({type:'update',entity:'trabalhador',id:worker.id,expectedVersion:worker._version,data:{ultimaAssinaturaEm:signedAt}});
        operations.push({type:'update',entity:'facial_cadastro',id:source.id,expectedVersion:source._version,data:{ultimaVerificacao:signedAt}});
      }
      operations.push({type:'update',entity:'facial_desafio',id:challenge.id,expectedVersion:challenge._version,data:{state:'APPROVED',resultId:id}});
      await commit(workerScope(worker.empresaId),`facial:${challenge.id}`,operations);
      committed=true;
      return {approved:true,item:await store.get(kind==='verify'?'ficha':'trabalhador',kind==='verify'?ficha.id:worker.id),replayed:false};
    }catch(error){
      if(committed)throw error;
      if(image)await provider.removeImage(image.key,image.version).catch(()=>{});
      await store.update('facial_desafio',challenge.id,{state:'FAILED',failureCode:error.code||'PROVIDER_ERROR'},{expectedVersion:challenge._version}).catch(()=>{});
      throw error;
    }
  }
  async function cancel(args){const item=await ownAttempt(args);if(['CREATING','READY','PROCESSING'].includes(item.state))await store.update('facial_desafio',item.id,{state:'CANCELLED'},{expectedVersion:item._version});return {cancelled:item.state!=='APPROVED'};}
  return {info,begin,complete,cancel,status};
}
