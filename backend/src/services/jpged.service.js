import { randomUUID, createPublicKey, verify } from 'node:crypto';
import { validateCaptureImage } from './capture-image.js';
import { httpError } from '../middleware/auth.js';
import { documentHash, sha256 } from './document-integrity.js';
import { buildSigningPdf, signingBytes, embedCms } from './jpged-pdf.js';
import { normalizeCpf, employerIdentity, representationActive } from './certificate-identity.js';
import { verifyCompanyCms } from './jpged-pki.js';

const error=(status,message,code)=>{throw httpError(status,message,code);};
const seconds=()=>Math.floor(Date.now()/1000);
const cmsBytes=value=>{if(typeof value!=='string'||value.length>45000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))error(400,'Assinatura digital inválida.','JPGED_CMS');return Buffer.from(value,'base64');};
export function createGedService({ged,store,validate=verifyCompanyCms,buildPdf=buildSigningPdf}) {
  async function audit(company,actor,action,details={}) {return ged.put(company,'AUDIT',`${Date.now()}-${randomUUID()}`,{actor,action,at:new Date().toISOString(),...details});}
  async function certificate(company) {const item=await ged.get(company,'CERT','current');return item?.active?item:null;}
  async function representation(company) {return ged.get(company,'REP','current');}
  async function targetFor(company) {return {...employerIdentity(company),representative:await representation(company.id)};}
  async function authorizeRepresentative(company,actor,body) {
    if(body.checked!==true)error(400,'Confirme a conferência do vínculo de representação.','REPRESENTACAO_CONFERENCIA');
    const cpf=normalizeCpf(body.cpf),name=String(body.name||'').trim(),reference=String(body.reference||'').trim(),capacity=body.capacity;
    if(name.length<3||name.length>200||reference.length<8||reference.length>500||!['titular','representante_legal','procurador'].includes(capacity))error(400,'Informe nome, vínculo e referência do documento conferido.','REPRESENTACAO_DADOS');
    const validUntil=String(body.validUntil||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)||!Number.isFinite(Date.parse(validUntil))||new Date(validUntil).toISOString().slice(0,10)!==validUntil||Date.parse(validUntil+'T23:59:59.999Z')<=Date.now())error(400,'Informe uma data futura para revisar a autorização.','REPRESENTACAO_VALIDADE');
    const previous=await representation(company.id),record=await ged.put(company.id,'REP','current',{...employerIdentity(company),cpf,name,reference,capacity,active:true,checkedBy:actor,checkedAt:new Date().toISOString(),validUntil:validUntil+'T23:59:59.999Z'},previous?.version||0);
    await audit(company.id,actor,'REPRESENTANTE_AUTORIZADO',{representationVersion:record.version});return record;
  }
  async function revokeRepresentative(company,actor) {
    const previous=await representation(company);if(previous){await ged.put(company,'REP','current',{...previous,active:false,revokedBy:actor,revokedAt:new Date().toISOString()},previous.version);await audit(company,actor,'REPRESENTANTE_REVOGADO',{representationVersion:previous.version});}
  }
  const configurationContent=(companyId,id,item)=>Buffer.from(JSON.stringify({schema:'JPGED-CONFIG-2',companyId,id,identity:item.target,companyName:item.companyName,nonce:item.nonce,scope:'Certificar fichas de EPI desta empresa confirmadas biometricamente',expiresAtEpoch:item.expiresAtEpoch}));
  async function configure(company,actor) {
    const item={kind:'configuration',actor,cnpj:company.cnpj,companyName:company.nome,target:await targetFor(company),nonce:randomUUID(),expiresAtEpoch:seconds()+300};
    const saved=await ged.put(company.id,'CONFIG',randomUUID(),item);
    return {...saved,contentBase64:configurationContent(company.id,saved.id,item).toString('base64')};
  }
  async function confirmConfiguration(company,actor,id,body) {
    const config=await ged.get(company.id,'CONFIG',id);
    if(!config||config.actor!==actor||config.expiresAtEpoch<=seconds()||config.used)error(409,'A configuração expirou. Inicie novamente.','CERTIFICADO_CONFIG_EXPIRADA');
    const target=await targetFor(company);
    if(JSON.stringify(target)!==JSON.stringify(config.target))error(409,'O vínculo do representante foi alterado. Inicie a configuração novamente.','CERTIFICADO_REPRESENTACAO_ALTERADA');
    const content=configurationContent(company.id,id,config),cms=cmsBytes(body.cms),result=await validate(cms,content,target);
    const previous=await ged.get(company.id,'CERT','current');
    if(previous)await audit(company.id,actor,'CERTIFICADO_SUBSTITUIDO',{fingerprint:previous.fingerprint});
    // Preserve the signed local authorization itself, not only a checkbox/audit message.
    const authorizationPath=`evidence/${company.id}/configuration/${id}.json`;
    await ged.saveBlob(authorizationPath,Buffer.from(JSON.stringify({content:content.toString('base64'),cms:cms.toString('base64'),identity:result.certificate,checkedAt:result.evidence.checkedAt})),'application/json');
    await ged.put(company.id,'CONFIG',id,{...config,used:true},config.version);
    const saved=await ged.put(company.id,'CERT','current',{...result.certificate,target:result.certificate.kind==='e-CPF'?target:{...employerIdentity(company),representative:null},authorizationPath,active:true,configuredAt:new Date().toISOString(),configuredBy:actor},previous?.version||0);
    await audit(company.id,actor,'CERTIFICADO_CONFIGURADO',{fingerprint:saved.fingerprint});
    return saved;
  }
  async function assertRepresentation(company,cert) {
    if(cert.kind!=='e-CPF')return;
    const representative=await representation(company);
    if(!representationActive(representative)||representative.version!==cert.target?.representative?.version||representative.cpf!==cert.cpf)error(409,'A autorização do representante mudou ou venceu. O Master deve revisá-la e o certificado deve ser configurado novamente.','CERTIFICADO_REPRESENTACAO_ALTERADA');
  }
  async function disconnect(company,actor) {const previous=await certificate(company);if(previous){await ged.put(company,'CERT','current',{...previous,active:false,disabledAt:new Date().toISOString()},previous.version);await audit(company,actor,'CERTIFICADO_DESVINCULADO',{fingerprint:previous.fingerprint});}}
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
    if(!cert)error(409,'Configure o certificado da empresa em Biometria. Sua confirmação biométrica já está salva.','CERTIFICADO_NAO_CONFIGURADO');
    if(new Date(cert.validTo).getTime()<=Date.now())error(409,'O certificado venceu. Atualize-o em Biometria.','CERTIFICADO_VENCIDO');
    await assertRepresentation(ficha.empresaId,cert);
    const built=await buildPdf(ficha,cert),id=randomUUID(),path=`staging/${ficha.empresaId}/${id}.pdf`;
    const stored=await ged.saveBlob(path,built.pdf);
    const job=await ged.put(ficha.empresaId,'JOB',id,{actor,fichaId:ficha.id,biometricId:ficha.assinaturaBiometrica.id,documentHash:hash,certificateFingerprint:cert.fingerprint,certificateVersion:cert.version,thumbprint:cert.thumbprint,cnpj:cert.cnpj||null,target:cert.target,subject:cert.subject,path,pdfHash:stored.hash,start:built.start,end:built.end,createdAt:new Date().toISOString(),expiresAtEpoch:seconds()+900});
    await audit(ficha.empresaId,actor,'CERTIFICACAO_INICIADA',{jobId:id,fichaId:ficha.id});return {jobId:id};
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
    await assertRepresentation(company,cert);
    const pdf=await ged.readBlob(job.path);if(sha256(pdf)!==job.pdfHash)error(409,'O arquivo preparado perdeu a integridade.','JPGED_INTEGRIDADE');
    return {job,ficha,cert,pdf};
  }
  async function signingPackage(company,actor,id) {const ctx=await context(company,actor,id);if(ctx.completed)return ctx;return {jobId:id,empresaId:company,cnpj:ctx.job.cnpj,subject:ctx.job.subject,thumbprint:ctx.cert.thumbprint,certificateFingerprint:ctx.cert.fingerprint,documentHash:ctx.job.documentHash,contentBase64:signingBytes(ctx.pdf,ctx.job.start,ctx.job.end).toString('base64')};}
  async function finish(company,actor,id,body) {
    const ctx=await context(company,actor,id);if(ctx.completed)return ctx;
    const {job,ficha,pdf}=ctx,cms=cmsBytes(body.cms),result=await validate(cms,signingBytes(pdf,job.start,job.end),ctx.cert.target||job.cnpj);
    await assertRepresentation(company,ctx.cert);
    if(result.certificate.fingerprint!==job.certificateFingerprint)error(409,'O documento foi assinado com outro certificado.','CERTIFICADO_ALTERADO');
    const final=embedCms(pdf,job.start,job.end,cms),pdfHash=sha256(final),path=`documents/${company}/${id}/${pdfHash}.pdf`,evidencePath=`evidence/${company}/${id}/${pdfHash}.json`;
    await ged.saveBlob(path,final);
    // Public CRLs are shared by content hash, instead of storing megabytes again
    // for every employee signature. Their original bytes remain recoverable.
    result.evidence.crls=await Promise.all((result.evidence.crls||[]).map(async crl=>{const crlPath=`validation/crls/${crl.sha256}.crl`;await ged.saveBlob(crlPath,Buffer.from(crl.der,'base64'),'application/pkix-crl');const {der,...metadata}=crl;return {...metadata,path:crlPath};}));
    await ged.saveBlob(evidencePath,Buffer.from(JSON.stringify({schema:'JPGED-1',documentHash:job.documentHash,pdfHash,cmsSha256:sha256(cms),certificate:result.certificate,representation:ctx.cert.kind==='e-CPF'?ctx.cert.target.representative:null,authorizationPath:ctx.cert.authorizationPath,validation:result.evidence})),'application/json');
    const documentId=ficha.id;
    let document=await ged.get(company,'DOC',documentId);
    if(!document)try{document=await ged.put(company,'DOC',documentId,{fichaId:ficha.id,numero:ficha.numero,trabalhadorId:ficha.trabalhadorId,trabalhadorNome:ficha.trabalhadorSnapshot?.nomeCompleto||ficha.trabalhadorNome,data:ficha.data,tipo:ficha.tipo,path,pdfHash,sizeBytes:final.length,evidencePath,documentHash:job.documentHash,biometricId:job.biometricId,biometricAt:ficha.assinaturaBiometrica.signedAt,certifiedAt:result.evidence.checkedAt,certificate:result.certificate,status:'certificado'});}catch(error){if(error.code!=='JPGED_CONFLICT')throw error;document=await ged.get(company,'DOC',documentId);if(!document)throw error;}
    const current=await store.get('ficha',ficha.id);
    if(!current.certificacao?.documentId)await store.update('ficha',ficha.id,{certificacao:{documentId,status:'certificado',pdfHash:document.pdfHash,certifiedAt:document.certifiedAt,certificateFingerprint:document.certificate.fingerprint}},{expectedVersion:current._version,expectedUpdatedAt:current.updatedAt});
    await ged.put(company,'JOB',id,{...job,used:true,documentId},job.version);
    await audit(company,actor,'DOCUMENTO_CERTIFICADO',{documentId,fichaId:ficha.id,pdfHash:document.pdfHash});
    return {completed:true,documentId,item:await store.get('ficha',ficha.id)};
  }
  async function documents(company,cursor) {const result=await ged.list(company,'DOC',cursor);return {...result,items:result.items.map(({path,evidencePath,pk,sk,...item})=>item)};}
  async function download(company,actor,id) {
    const item=await ged.get(company,'DOC',id);if(!item)error(404,'Documento não encontrado.','JPGED_DOCUMENTO');
    await audit(company,actor,'DOCUMENTO_BAIXADO',{documentId:id});
    return {url:await ged.download(item.path,`Ficha-EPI-${item.numero||id}.pdf`),sha256:item.pdfHash,expiresIn:60};
  }
  return {certificate,representation,authorizeRepresentative,revokeRepresentative,configure,confirmConfiguration,disconnect,prepare,signingPackage,finish,documents,download};
}
