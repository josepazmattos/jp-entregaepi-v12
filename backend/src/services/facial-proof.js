import {createPublicKey,verify} from 'node:crypto';
import {documentHash,sha256} from './document-integrity.js';
import {httpError} from '../middleware/auth.js';
export const FACIAL_METHOD='AWS_REKOGNITION_FACE_LIVENESS';
export const FACIAL_NOTICE_ID='JP-FACIAL-ENTREGA-20261030-v1';
export const FACIAL_POLICY=Object.freeze({liveness:98,similarity:99.5,version:'JP-FACIAL-1'});
export const facialEnrollmentId=worker=>sha256(`${worker.empresaId}\0${worker.id}\0FACIAL`);
export function trustedFacialKeys(){try{return JSON.parse(process.env.FACIAL_TRUSTED_KEYS||'{}');}catch{return {};}}
export function verifyFacialProof(ficha,keys=trustedFacialKeys()){
  const invalid=()=>{throw httpError(409,'A evidência facial não pôde ser validada para esta ficha.','FACIAL_PROVA_INVALIDA');};
  const bio=ficha?.assinaturaBiometrica;
  if(ficha?.status!=='assinada'||bio?.metodo!==FACIAL_METHOD||bio.verificada!==true)return invalid();
  let proof;
  try{
    if(typeof bio.proof!=='string'||bio.proof.length>16000||typeof bio.proofSignature!=='string'||bio.proofSignature.length>256)throw Error();
    const pinned=keys[bio.keyArn];if(!pinned||pinned!==bio.publicKey)throw Error();
    const key=createPublicKey({key:Buffer.from(pinned,'base64'),type:'spki',format:'der'});
    if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1'||!verify('sha256',Buffer.from(bio.proof),key,Buffer.from(bio.proofSignature,'base64')))throw Error();
    proof=JSON.parse(bio.proof);
  }catch{return invalid();}
  if(proof.v!==1||proof.method!==FACIAL_METHOD||proof.kind!=='verify'||proof.matched!==true||proof.fichaId!==ficha.id||proof.workerId!==ficha.trabalhadorId||proof.companyId!==ficha.empresaId||proof.documentHash!==documentHash(ficha)||proof.acceptance?.confirmado!==true||proof.acceptance?.texto!==ficha.modeloFicha?.termoAssinatura||proof.acceptance?.versao!==ficha.modeloFicha?.termoAssinaturaId||proof.acceptance?.metodo!=='FACIAL'||proof.sessionStatus!=='SUCCEEDED'||!Number.isFinite(proof.liveness)||proof.liveness<FACIAL_POLICY.liveness||!Number.isFinite(proof.similarity)||proof.similarity<FACIAL_POLICY.similarity||proof.faceCount!==1||!/^[a-f0-9]{64}$/.test(proof.imageHash||'')||!/^[a-f0-9]{64}$/.test(proof.referenceHash||'')||!proof.sessionId||!proof.enrollmentId||proof.signedAt!==bio.signedAt)return invalid();
  return proof.documentHash;
}
