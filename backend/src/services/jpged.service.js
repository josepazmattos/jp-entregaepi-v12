import { randomUUID, createPublicKey, verify } from 'node:crypto';
import { validateCaptureImage } from './capture-image.js';
import { httpError } from '../middleware/auth.js';
import { documentHash, sha256 } from './document-integrity.js';
import { buildSigningPdf, signingBytes, embedCms } from './jpged-pdf.js';
import { employerIdentity, canonicalEmployerTarget, sameEmployerTarget } from './certificate-identity.js';
import { verifyCompanyCms } from './jpged-pki.js';
import { keyVault } from './jpged-kms.js';
import { detachedCms } from './jpged-cms.js';
import { createVaultService } from './jpged-vault.js';
import { documentFilename } from './document-filename.js';
import { createLayoutService, COMPACT_LAYOUT } from './jpged-layout.js';

const error=(status,message,code)=>{throw httpError(status,message,code);};
const seconds=()=>Math.floor(Date.now()/1000);
const cmsBytes=value=>{if(typeof value!=='string'||value.length>45000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))error(400,'Assinatura digital inválida.','JPGED_CMS');return Buffer.from(value,'base64');};
export function createGedService({ged,store,validate=verifyCompanyCms,buildPdf=buildSigningPdf,vault=keyVault}) {
  async function audit(company,actor,action,details={}) {return ged.put(company,'AUDIT',`${Date.now()}-${randomUUID()}`,{actor,action,at:new Date().toISOString(),...details});}
  const vaultAdmin=createVaultService({ged,vault,validate,audit});
  const layouts=createLayoutService({ged,store,certificate,confirmedContent,buildPdf,validate,vault,audit});
  async function certificate(company) {const item=await ged.get(company,'CERT','current');return item?.active?item:null;}
  const configurationContent=(companyId,id,item)=>Buffer.from(JSON.stringify({schema:'JPGED-CONFIG-2',companyId,id,identity:canonicalEmployerTarget(item.target),companyName:item.companyName,nonce:item.nonce,scope:'Certificar fichas de EPI desta empresa confirmadas biometricamente',expiresAtEpoch:item.expiresAtEpoch}));
  async function configure(company,actor) {
    const item={kind:'configuration',actor,cnpj:company.cnpj,companyName:company.nome,target:employerIdentity(company),nonce:randomUUID(),expiresAtEpoch:seconds()+300};
    const saved=await ged.put(company.id,'CONFIG',randomUUID(),item);
    return {...saved,contentBase64:configurationContent(company.id,saved.id,item).toString('base64')};
  }
  async function confirmConfiguration(company,actor,id,body) {
    const config=await ged.get(company.id,'CONFIG',id);
    if(!config||config.actor!==actor||config.expiresAtEpoch<=seconds()||config.used)error(409,'A configuração expirou. Inicie novamente.','CERTIFICADO_CONFIG_EXPIRADA');
    const target=employerIdentity(company);
    if(!sameEmployerTarget(target,config.target))error(409,'A identificação do empregador foi alterada. Inicie a configuração novamente.','CERTIFICADO_EMPREGADOR_ALTERADO');
    const content=configurationContent(company.id,id,config),cms=cmsBytes(body.cms),result=await validate(cms,content,target);
    const previous=await ged.get(company.id,'CERT','current');
    if(previous)await audit(company.id,actor,'CERTIFICADO_SUBSTITUIDO',{fingerprint:previous.fingerprint});
    // Preserve the signed local authorization itself, not only a checkbox/audit message.
    const authorizationPath=`evidence/${company.id}/configuration/${id}.json`;
    await ged.saveBlob(authorizationPath,Buffer.from(JSON.stringify({content:content.toString('base64'),cms:cms.toString('base64'),identity:result.certificate,checkedAt:result.evidence.checkedAt})),'application/json');
    await ged.put(company.id,'CONFIG',id,{...config,used:true},config.version);
    const saved=await ged.put(company.id,'CERT','current',{...result.certificate,target,authorizationPath,active:true,configuredAt:new Date().toISOString(),configuredBy:actor},previous?.version||0);
    await audit(company.id,actor,'CERTIFICADO_CONFIGURADO',{fingerprint:saved.fingerprint});
    return saved;
  }
  async function disconnect(company,actor) {const previous=await certificate(company);if(previous){await ged.put(company,'CERT','current',{...previous,active:false,disabledAt:new Date().toISOString()},previous.version);await audit(company,actor,'CERTIFICADO_DESVINCULADO',{fingerprint:previous.fingerprint});if(previous.mode==='vault')await vault.retire(previous.keyArn);}}
  function confirmedContent(ficha) {
    if(ficha.status!=='assinada'||ficha.assinaturaBiometrica?.verificada!==true)error(409,'Confirme a biometria antes de certificar o documento.','JPGED_BIOMETRIA_PENDENTE');
    const bio=ficha.assinaturaBiometrica;let proof;
    try {proof=JSON.parse(bio.proof);if(!verify('sha256',Buffer.from(bio.proof),createPublicKey({key:Buffer.from(bio.publicKey,'base64'),format:'der',type:'spki'}),Buffer.from(bio.proofSignature,'base64')))throw new Error();}
    catch{error(409,'A prova biométrica não pôde ser validada.','JPGED_PROVA_INVALIDA');}
    if(!proof.documentHash)error(409,'Esta ficha possui um registro biométrico anterior ao JPGED. O original permanece disponível no fluxo anterior.','JPGED_REGISTRO_ANTERIOR');
    if(proof.documentHash!==documentHash(ficha)||proof.fichaId!==ficha.id||proof.workerId!==ficha.trabalhadorId||proof.matched!==true)error(409,'O conteúdo da ficha difere do confirmado pelo trabalhador.','JPGED_DOCUMENTO_ALTERADO');
    const captured=validateCaptureImage(bio.realFingerImage);
    if(proof.imageHash!==sha256(captured.bytes)||proof.fingerCode!==bio.dedo||proof.kind!=='verify')error(409,'A imagem da confirmação biométrica perdeu a integridade.','JPGED_PROVA_INVALIDA');
    return proof.documentHash;
  }
  async function prepare(ficha,actor) {
    const hash=confirmedContent(ficha);
    if(ficha.certificacao?.documentId)return {documentId:ficha.certificacao.documentId,completed:true};
    const cert=await certificate(ficha.empresaId);
    if(!cert)error(409,'Configure o certificado da empresa em Sistema → Certificado Digital. Sua confirmação biométrica já está salva.','CERTIFICADO_NAO_CONFIGURADO');
    if(new Date(cert.validTo).getTime()<=Date.now())error(409,'O certificado venceu. Atualize-o em Sistema → Certificado Digital.','CERTIFICADO_VENCIDO');
    const built=await buildPdf(ficha,cert),id=randomUUID(),path=`staging/${ficha.empresaId}/${id}.pdf`;
    const stored=await ged.saveBlob(path,built.pdf);
    const job=await ged.put(ficha.empresaId,'JOB',id,{actor,fichaId:ficha.id,biometricId:ficha.assinaturaBiometrica.id,documentHash:hash,certificateFingerprint:cert.fingerprint,certificateVersion:cert.version,thumbprint:cert.thumbprint,cnpj:cert.cnpj||null,target:cert.target,subject:cert.subject,path,pdfHash:stored.hash,start:built.start,end:built.end,createdAt:new Date().toISOString(),expiresAtEpoch:seconds()+900});
    await audit(ficha.empresaId,actor,'CERTIFICACAO_INICIADA',{jobId:id,fichaId:ficha.id});return {jobId:id,mode:cert.mode||'local'};
  }
  async function context(company,actor,id) {
    const job=await ged.get(company,'JOB',id);
    if(!job||job.actor!==actor)error(404,'Solicitação não encontrada.','JPGED_JOB');
    if(job.used)return {completed:true,documentId:job.documentId};
    if(job.expiresAtEpoch<=seconds())error(410,'A certificação expirou. Tente novamente sem repetir a biometria.','JPGED_JOB_EXPIRED');
    const ficha=await store.get('ficha',job.fichaId),cert=await certificate(company);
    if(ficha?.empresaId===company&&ficha.certificacao?.documentId)return {completed:true,documentId:ficha.certificacao.documentId};
    if(!ficha||ficha.empresaId!==company||confirmedContent(ficha)!==job.documentHash||ficha.assinaturaBiometrica.id!==job.biometricId)error(409,'O documento foi alterado.','JPGED_DOCUMENTO_ALTERADO');
    if(!cert||cert.version!==job.certificateVersion||cert.fingerprint!==job.certificateFingerprint)error(409,'O certificado foi alterado. Inicie novamente.','CERTIFICADO_ALTERADO');
    const pdf=await ged.readBlob(job.path);if(sha256(pdf)!==job.pdfHash)error(409,'O arquivo preparado perdeu a integridade.','JPGED_INTEGRIDADE');
    return {job,ficha,cert,pdf};
  }
  async function signingPackage(company,actor,id) {const ctx=await context(company,actor,id);if(ctx.completed)return ctx;return {jobId:id,empresaId:company,cnpj:ctx.job.cnpj,subject:ctx.job.subject,thumbprint:ctx.cert.thumbprint,certificateFingerprint:ctx.cert.fingerprint,documentHash:ctx.job.documentHash,contentBase64:signingBytes(ctx.pdf,ctx.job.start,ctx.job.end).toString('base64')};}
  async function finish(company,actor,id,body,internal=false) {
    const ctx=await context(company,actor,id);if(ctx.completed)return ctx;
    if(ctx.cert.mode==='vault'&&!internal)error(403,'Esta ficha deve ser certificada pelo cofre.','COFRE_ASSINATURA_EXTERNA');
    const {job,ficha,pdf}=ctx,cms=cmsBytes(body.cms),result=await validate(cms,signingBytes(pdf,job.start,job.end),ctx.cert.target||job.cnpj);
    if(result.certificate.fingerprint!==job.certificateFingerprint)error(409,'O documento foi assinado com outro certificado.','CERTIFICADO_ALTERADO');
    const final=embedCms(pdf,job.start,job.end,cms),pdfHash=sha256(final),path=`documents/${company}/${id}/${pdfHash}.pdf`,evidencePath=`evidence/${company}/${id}/${pdfHash}.json`;
    await ged.saveBlob(path,final);
    // Public CRLs are shared by content hash, instead of storing megabytes again
    // for every employee signature. Their original bytes remain recoverable.
    result.evidence.crls=await Promise.all((result.evidence.crls||[]).map(async crl=>{const crlPath=`validation/crls/${crl.sha256}.crl`;await ged.saveBlob(crlPath,Buffer.from(crl.der,'base64'),'application/pkix-crl');const {der,...metadata}=crl;return {...metadata,path:crlPath};}));
    await ged.saveBlob(evidencePath,Buffer.from(JSON.stringify({schema:'JPGED-1',documentHash:job.documentHash,pdfHash,cmsSha256:sha256(cms),certificate:result.certificate,authorizationPath:ctx.cert.authorizationPath,validation:result.evidence})),'application/json');
    const documentId=ficha.id;
    let document=await ged.get(company,'DOC',documentId);
    if(!document)try{document=await ged.put(company,'DOC',documentId,{fichaId:ficha.id,numero:ficha.numero,trabalhadorId:ficha.trabalhadorId,trabalhadorNome:ficha.trabalhadorSnapshot?.nomeCompleto||ficha.trabalhadorNome,data:ficha.data,tipo:ficha.tipo,path,pdfHash,sizeBytes:final.length,evidencePath,documentHash:job.documentHash,biometricId:job.biometricId,biometricAt:ficha.assinaturaBiometrica.signedAt,certifiedAt:result.evidence.checkedAt,certificate:result.certificate,status:'certificado',layoutVersion:COMPACT_LAYOUT});}catch(error){if(error.code!=='JPGED_CONFLICT')throw error;document=await ged.get(company,'DOC',documentId);if(!document)throw error;}
    const current=await store.get('ficha',ficha.id);
    if(!current.certificacao?.documentId)await store.update('ficha',ficha.id,{certificacao:{documentId,status:'certificado',pdfHash:document.pdfHash,certifiedAt:document.certifiedAt,certificateFingerprint:document.certificate.fingerprint}},{expectedVersion:current._version,expectedUpdatedAt:current.updatedAt});
    await ged.put(company,'JOB',id,{...job,used:true,documentId},job.version);
    await audit(company,actor,'DOCUMENTO_CERTIFICADO',{documentId,fichaId:ficha.id,pdfHash:document.pdfHash});
    return {completed:true,documentId,item:await store.get('ficha',ficha.id)};
  }
  async function certify(company,actor,id){
    const ctx=await context(company,actor,id);if(ctx.completed)return ctx;
    if(ctx.cert.mode!=='vault')error(409,'O Master precisa cadastrar o certificado no cofre.','COFRE_NAO_CONFIGURADO');
    const built=detachedCms(signingBytes(ctx.pdf,ctx.job.start,ctx.job.end),ctx.cert.chain);
    const cms=built.complete(await vault.sign(ctx.cert.keyArn,built.signedBytes));
    return finish(company,actor,id,{cms:cms.toString('base64')},true);
  }
  async function publicCertificate(company){const cert=await certificate(company);if(!cert)return null;const {keyArn,chain,pk,sk,target,authorizationPath,configuredBy,...publicData}=cert;return {...publicData,...(cert.mode==='vault'?{vaultState:await vault.status(cert.keyArn)}:{})};}
  async function documents(company,cursor) {
    const result=await ged.list(company,'DOC',cursor);
    return {...result,items:await Promise.all(result.items.map(async({path,evidencePath,pk,sk,...item})=>{
      const compactRevision=layouts.summary(await layouts.revision(company,item));
      if(process.env.V10_SYNC_ENABLED!=='true')return {...item,compactRevision};
      const sync=await ged.get(company,'SYNCV10',item.id),hash=compactRevision?.pdfHash||item.pdfHash;
      const synced=sync?.status==='synced'&&sync.pdfHash===hash;
      return {...item,compactRevision,v10Sync:{status:synced?'synced':'pending',
        message:synced?'':sync?.pdfHash===hash&&sync.message?sync.message:'Envio pendente. O sistema tentará automaticamente.',
        ...(synced?{syncedAt:sync.syncedAt}:{})}};
    }))};
  }
  async function download(company,actor,id,{original=false}={}) {
    const item=await ged.get(company,'DOC',id);if(!item)error(404,'Documento não encontrado.','JPGED_DOCUMENTO');
    const selected=original?item:(await layouts.revision(company,item)||item);
    await audit(company,actor,'DOCUMENTO_BAIXADO',{documentId:id,pdfHash:selected.pdfHash,version:original?'original':'atual'});
    const filename=documentFilename(item);
    return {url:await ged.download(selected.path,filename),filename,sha256:selected.pdfHash,expiresIn:60};
  }
  return {certificate:publicCertificate,vaultAdmin,certify,configure,confirmConfiguration,disconnect,prepare,signingPackage,finish,documents,download,reissueLayout:layouts.reissue};
}
