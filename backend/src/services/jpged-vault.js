import {randomUUID,verify} from 'node:crypto';
import {httpError} from '../middleware/auth.js';
import {employerIdentity,canonicalEmployerTarget,sameEmployerTarget} from './certificate-identity.js';
import {detachedCms,publicChain} from './jpged-cms.js';
import {verifyCompanyCms} from './jpged-pki.js';
const fail=(message,code='COFRE_CONFIGURACAO')=>{throw httpError(409,message,code);};
const now=()=>Math.floor(Date.now()/1000);
const base64=(s,max=12000)=>{if(typeof s!=='string'||s.length>max||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))fail('Resposta criptográfica inválida.');return Buffer.from(s,'base64');};
// Longer than the worker's 120-second execution limit. An abandoned invocation
// cannot overlap a replacement import after this lease has expired.
const processing=item=>item?.processingUntilEpoch>now();
export function createVaultService({ged,vault,validate=verifyCompanyCms,audit,loadCompany}){
  const content=item=>Buffer.from(JSON.stringify({schema:'JPGED-COFRE-1',id:item.importId,companyId:item.empresaId,companyName:item.companyName,target:canonicalEmployerTarget(item.target),actor:item.actor,nonce:item.nonce,expires:item.validUntilEpoch,scope:'Autorizar exclusivamente a certificação das fichas de EPI desta empresa confirmadas biometricamente'}));
  const cms=item=>detachedCms(content(item),item.chain,new Date(item.createdAt));
  const evidencePath=(company,id)=>`evidence/${company}/vault/${id}.json`;
  async function owned(company,actor,id){
    const item=await ged.get(company.id,'IMPORT','current');
    if(!item||item.actor!==actor||item.importId!==id)fail('A configuração expirou. Inicie novamente.','COFRE_EXPIRADO');
    return item;
  }
  async function employerUnchanged(company,item){
    const latest=loadCompany?await loadCompany(company.id):company;
    if(!latest||latest.excluidaEm||!sameEmployerTarget(employerIdentity(latest),item.target))fail('O cadastro da empresa mudou. Inicie novamente.','COFRE_EMPRESA_ALTERADA');
  }
  async function installed(company,item){
    const cert=await ged.get(company.id,'CERT','current');
    return cert?.active&&cert.keyArn===item.keyArn&&cert.authorizationPath===evidencePath(company.id,item.importId)?cert:null;
  }
  async function current(company,actor,id){
    const item=await owned(company,actor,id);
    if(item.validUntilEpoch<=now()||item.used)fail('A configuração expirou. Inicie novamente.','COFRE_EXPIRADO');
    await employerUnchanged(company,item);return item;
  }
  async function note(company,actor,action,details){
    try{await audit(company,actor,action,details);}catch{console.warn('COFRE_AUDITORIA_PENDENTE');}
  }
  async function retire(company,actor,arn){
    if(!arn)return;
    try{await vault.retire(arn);}catch{await note(company,actor,'COFRE_LIMPEZA_PENDENTE',{keyArn:arn});}
  }
  async function failed(company,item,error){
    // A lost DynamoDB response must never cause deletion of a committed key.
    // If the consistent read itself fails, leave cleanup to a later attempt.
    const cert=await installed(company,item);
    if(cert)return cert;
    const fresh=await ged.get(company.id,'IMPORT','current');
    if(fresh?.importId===item.importId&&['proving','completing'].includes(fresh.phase)){
      await ged.put(company.id,'IMPORT','current',{...fresh,keyArn:item.keyArn||fresh.keyArn,phase:'failed',used:true,processingUntilEpoch:0,importToken:null,wrappingKey:null,failure:{code:error.status?error.code||'COFRE_CONFIGURACAO':'COFRE_SERVICO_INDISPONIVEL',message:error.status?error.message:'A instalação não foi concluída. Atualize a situação e tente novamente.'}},fresh.version);
    }
    await retire(company.id,item.actor,item.keyArn);
    return null;
  }
  async function status(company,actor,id){
    const item=await owned(company,actor,id);
    if(await installed(company,item))return {phase:'installed',installed:true};
    if(item.phase==='failed')return {phase:'failed',failure:item.failure};
    if(item.used)return {phase:'cancelled'};
    if(!processing(item)&&(item.processingUntilEpoch||item.validUntilEpoch<=now()))return {phase:'expired'};
    await employerUnchanged(company,item);
    if(item.phase==='proved')return {phase:'proved',wrappingKey:item.wrappingKey};
    return {phase:item.phase||'prepared'};
  }
  async function start(company,actor,body){
    const chain=publicChain(body.chain),leaf=chain[0];
    if(leaf.publicKey.asymmetricKeyType!=='rsa'||![2048,3072,4096].includes(leaf.publicKey.asymmetricKeyDetails.modulusLength))fail('Use um certificado A1 RSA de 2048, 3072 ou 4096 bits.','COFRE_TIPO');
    const old=await ged.get(company.id,'IMPORT','current');
    if(processing(old)||old&&!old.used&&old.validUntilEpoch>now())fail('Já existe uma configuração em andamento. Aguarde até cinco minutos antes de tentar novamente.','COFRE_OCUPADO');
    const previous=await ged.get(company.id,'CERT','current');
    // Claim the version before retiring an expired attempt. A competing start
    // or completion can no longer lose its key to stale cleanup.
    const item=await ged.put(company.id,'IMPORT','current',{importId:randomUUID(),actor,target:employerIdentity(company),companyName:company.nome,chain:body.chain,bits:leaf.publicKey.asymmetricKeyDetails.modulusLength,nonce:randomUUID(),createdAt:new Date().toISOString(),validUntilEpoch:now()+300,previousVersion:previous?.version||0,phase:'prepared'},old?.version||0);
    if(old?.keyArn&&old.keyArn!==previous?.keyArn)await retire(company.id,actor,old.keyArn);
    return {id:item.importId,companyName:company.nome,contentBase64:content(item).toString('base64'),signingBase64:cms(item).signedBytes.toString('base64')};
  }
  async function prove(company,actor,id,body){
    let item=await current(company,actor,id);
    if(item.phase==='proved')return {wrappingKey:item.wrappingKey};
    if(processing(item))return {pending:true};
    if(item.proved)fail('Esta etapa já foi concluída.');
    item=await ged.put(company.id,'IMPORT','current',{...item,phase:'proving',processingUntilEpoch:now()+150},item.version);
    let arn;
    try{
      const signature=base64(body.signature),built=cms(item);
      if(!verify('sha256',built.signedBytes,publicChain(item.chain)[0].publicKey,signature))fail('A chave não corresponde ao certificado.','COFRE_CHAVE_DIVERGENTE');
      const proof=built.complete(signature),result=await validate(proof,content(item),item.target);
      await employerUnchanged(company,item);
      arn=await vault.create(company.id,id,item.bits);
      item=await ged.put(company.id,'IMPORT','current',{...item,keyArn:arn},item.version);
      const parameters=await vault.parameters(arn);
      await ged.saveBlob(evidencePath(company.id,id),Buffer.from(JSON.stringify({content:content(item).toString('base64'),cms:proof.toString('base64'),certificate:result.certificate,checkedAt:result.evidence.checkedAt})),'application/json');
      item=await ged.put(company.id,'IMPORT','current',{...item,phase:'proved',proved:true,metadata:result.certificate,importToken:parameters.importToken,wrappingKey:parameters.wrappingKey,processingUntilEpoch:0},item.version);
      return {wrappingKey:parameters.wrappingKey};
    }catch(e){await failed(company,{...item,keyArn:arn||item.keyArn},e);throw e;}
  }
  async function complete(company,actor,id,body){
    let item=await owned(company,actor,id);
    const committedBefore=await installed(company,item);if(committedBefore)return committedBefore;
    item=await current(company,actor,id);
    if(processing(item))return {pending:true};
    if(item.completing)fail('A configuração não terminou. Inicie novamente.');
    if(!item.keyArn||!item.importToken||!item.proved)fail('Reinicie a configuração do cofre.');
    item=await ged.put(company.id,'IMPORT','current',{...item,phase:'completing',completing:true,processingUntilEpoch:now()+150},item.version);
    let saved,previous;
    try{
      const wrapped=base64(body.wrappedKey,16000);
      if(wrapped.length<700)fail('Material protegido incompleto.');
      const spki=await vault.import(item.keyArn,wrapped,item.importToken,item.metadata.validTo);
      if(!spki.equals(publicChain(item.chain)[0].publicKey.export({type:'spki',format:'der'})))fail('A chave importada não corresponde ao certificado.','COFRE_CHAVE_DIVERGENTE');
      const evidence=JSON.parse((await ged.readBlob(evidencePath(company.id,id))).toString('utf8'));
      if(evidence.content!==content(item).toString('base64'))fail('A autorização de importação foi alterada.','COFRE_AUTORIZACAO');
      const result=await validate(Buffer.from(evidence.cms,'base64'),content(item),item.target);
      await employerUnchanged(company,item);
      previous=await ged.get(company.id,'CERT','current');
      saved=await ged.put(company.id,'CERT','current',{...result.certificate,mode:'vault',keyArn:item.keyArn,chain:result.evidence.certificates,target:item.target,authorizationPath:evidencePath(company.id,id),active:true,configuredAt:new Date().toISOString(),configuredBy:actor},item.previousVersion);
    }catch(e){saved=await failed(company,item,e);if(!saved)throw e;}
    // The certificate row is authoritative. Auxiliary failures cannot turn a
    // successful activation into cancellation or delete the active key.
    try{await ged.put(company.id,'IMPORT','current',{...item,phase:'installed',used:true,completing:false,processingUntilEpoch:0,importToken:null,wrappingKey:null},item.version);}catch{await note(company.id,actor,'COFRE_ESTADO_PENDENTE',{});}
    await note(company.id,actor,'COFRE_ATIVADO',{fingerprint:saved.fingerprint});
    if(previous?.mode==='vault'&&previous.keyArn!==saved.keyArn)await retire(company.id,actor,previous.keyArn);
    return saved;
  }
  async function cancel(company,actor,id){
    const item=await ged.get(company.id,'IMPORT','current');
    if(!item||item.actor!==actor||item.importId!==id||item.used)return;
    if(await installed(company,item))return;
    if(processing(item)||item.completing&&item.validUntilEpoch>now())fail('A configuração está em andamento. Aguarde e atualize a situação.','COFRE_EM_ANDAMENTO');
    // Lock before cleanup so cancellation cannot race a new worker.
    await ged.put(company.id,'IMPORT','current',{...item,phase:'cancelled',used:true,importToken:null,wrappingKey:null},item.version);
    const cert=await ged.get(company.id,'CERT','current');
    if(item.keyArn&&cert?.keyArn!==item.keyArn)await retire(company.id,actor,item.keyArn);
  }
  return {start,prove,complete,cancel,status};
}
