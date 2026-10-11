import {randomUUID,verify} from 'node:crypto';
import {httpError} from '../middleware/auth.js';
import {employerIdentity} from './certificate-identity.js';
import {detachedCms,publicChain} from './jpged-cms.js';
import {verifyCompanyCms} from './jpged-pki.js';
const fail=(message,code='COFRE_CONFIGURACAO')=>{throw httpError(409,message,code);};
const now=()=>Math.floor(Date.now()/1000);
const base64=(s,max=12000)=>{if(typeof s!=='string'||s.length>max||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))fail('Resposta criptográfica inválida.');return Buffer.from(s,'base64');};
export function createVaultService({ged,vault,validate=verifyCompanyCms,audit}){
  const content=item=>Buffer.from(JSON.stringify({schema:'JPGED-COFRE-1',id:item.importId,companyId:item.empresaId,companyName:item.companyName,target:item.target,actor:item.actor,nonce:item.nonce,expires:item.validUntilEpoch,scope:'Autorizar exclusivamente a certificação das fichas de EPI desta empresa confirmadas biometricamente'}));
  const cms=item=>detachedCms(content(item),item.chain,new Date(item.createdAt));
  async function current(company,actor,id){
    const item=await ged.get(company.id,'IMPORT','current');
    if(!item||item.actor!==actor||item.importId!==id||item.validUntilEpoch<=now()||item.used)fail('A configuração expirou. Inicie novamente.','COFRE_EXPIRADO');
    if(JSON.stringify(employerIdentity(company))!==JSON.stringify(item.target))fail('O cadastro da empresa mudou. Inicie novamente.');return item;
  }
  async function start(company,actor,body){
    const chain=publicChain(body.chain),leaf=chain[0];
    if(leaf.publicKey.asymmetricKeyType!=='rsa'||![2048,3072,4096].includes(leaf.publicKey.asymmetricKeyDetails.modulusLength))fail('Use um certificado A1 RSA de 2048, 3072 ou 4096 bits.','COFRE_TIPO');
    const old=await ged.get(company.id,'IMPORT','current');
    if(old&&!old.used&&old.validUntilEpoch>now())fail('Já existe uma configuração em andamento. Aguarde até cinco minutos antes de tentar novamente.','COFRE_OCUPADO');
    const previous=await ged.get(company.id,'CERT','current');
    if(old?.keyArn&&!old.used&&old.keyArn!==previous?.keyArn)await vault.retire(old.keyArn);
    // Lock before any billable key creation. Nothing private enters this record.
    const item=await ged.put(company.id,'IMPORT','current',{importId:randomUUID(),actor,target:employerIdentity(company),companyName:company.nome,chain:body.chain,bits:leaf.publicKey.asymmetricKeyDetails.modulusLength,nonce:randomUUID(),createdAt:new Date().toISOString(),validUntilEpoch:now()+300,previousVersion:previous?.version||0},old?.version||0);
    return {id:item.importId,companyName:company.nome,contentBase64:content(item).toString('base64'),signingBase64:cms(item).signedBytes.toString('base64')};
  }
  async function prove(company,actor,id,body){
    let item=await current(company,actor,id);
    if(item.proved)fail('Esta etapa já foi concluída.');
    const signature=base64(body.signature),built=cms(item);
    if(!verify('sha256',built.signedBytes,publicChain(item.chain)[0].publicKey,signature))fail('A chave não corresponde ao certificado.','COFRE_CHAVE_DIVERGENTE');
    const proof=built.complete(signature),result=await validate(proof,content(item),item.target);
    item=await ged.put(company.id,'IMPORT','current',{...item,proved:true,metadata:result.certificate},item.version);
    let arn;
    try{
      arn=await vault.create(company.id,id,item.bits);
      item=await ged.put(company.id,'IMPORT','current',{...item,keyArn:arn},item.version);
      const parameters=await vault.parameters(arn);
      item=await ged.put(company.id,'IMPORT','current',{...item,importToken:parameters.importToken},item.version);
      const authorizationPath=`evidence/${company.id}/vault/${id}.json`;
      await ged.saveBlob(authorizationPath,Buffer.from(JSON.stringify({content:content(item).toString('base64'),cms:proof.toString('base64'),certificate:result.certificate,checkedAt:result.evidence.checkedAt})),'application/json');
      return {wrappingKey:parameters.wrappingKey};
    }catch(e){if(arn)await vault.retire(arn);throw e;}
  }
  async function complete(company,actor,id,body){
    let item=await current(company,actor,id);
    if(item.completing)fail('A configuração está sendo concluída. Atualize a situação antes de tentar novamente.');
    if(!item.keyArn||!item.importToken||!item.proved)fail('Reinicie a configuração do cofre.');
    const wrapped=base64(body.wrappedKey,16000);
    if(wrapped.length<700)fail('Material protegido incompleto.');
    item=await ged.put(company.id,'IMPORT','current',{...item,completing:true},item.version);
    let committed=false;
    try{
      const spki=await vault.import(item.keyArn,wrapped,item.importToken,item.metadata.validTo);
      if(!spki.equals(publicChain(item.chain)[0].publicKey.export({type:'spki',format:'der'})))fail('A chave importada não corresponde ao certificado.','COFRE_CHAVE_DIVERGENTE');
      // A real KMS signature verifies both custody and possession before activation.
      const built=cms(item),proof=built.complete(await vault.sign(item.keyArn,built.signedBytes));
      const result=await validate(proof,content(item),item.target);
      const previous=await ged.get(company.id,'CERT','current');
      const saved=await ged.put(company.id,'CERT','current',{...result.certificate,mode:'vault',keyArn:item.keyArn,chain:item.chain,target:item.target,authorizationPath:`evidence/${company.id}/vault/${id}.json`,active:true,configuredAt:new Date().toISOString(),configuredBy:actor},item.previousVersion);
      committed=true;
      await ged.put(company.id,'IMPORT','current',{...item,used:true,importToken:null},item.version);
      await audit(company.id,actor,'COFRE_ATIVADO',{fingerprint:saved.fingerprint});
      if(previous?.mode==='vault'&&previous.keyArn!==saved.keyArn){try{await vault.retire(previous.keyArn);}catch{await audit(company.id,actor,'COFRE_LIMPEZA_PENDENTE',{keyArn:previous.keyArn});}}
      return saved;
    }catch(e){if(!committed)await vault.retire(item.keyArn);throw e;}
  }
  async function cancel(company,actor,id){
    const item=await ged.get(company.id,'IMPORT','current');
    if(!item||item.actor!==actor||item.importId!==id||item.used)return;
    if(item.completing&&item.validUntilEpoch>now())fail('A configuração está em andamento. Aguarde e atualize a situação.');
    const cert=await ged.get(company.id,'CERT','current');
    if(item.keyArn&&cert?.keyArn!==item.keyArn)await vault.retire(item.keyArn);
    await ged.put(company.id,'IMPORT','current',{...item,used:true,importToken:null},item.version);
  }
  return {start,prove,complete,cancel};
}
