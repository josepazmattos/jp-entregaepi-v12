import { createHash, createPublicKey, verify, randomUUID } from 'node:crypto';
import { httpError } from '../middleware/auth.js';
import { validateCaptureImage } from './capture-image.js';
import { workerScope } from './trabalhadores-import.service.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const fingerValid = value => typeof value === 'string' && /^(R|L)_(THUMB|INDEX|MIDDLE|RING|LITTLE)$/.test(value);
const bad = (message, code = 'BIOMETRIA_INVALIDA', status = 400) => { throw httpError(status, message, code); };
const enrollmentId = (worker, finger) => hash(`${worker.empresaId}\0${worker.id}\0${finger}`);
export function signaturePending(ficha) {return ficha?.status==='pendente' || ficha?.status==='assinada' && ficha.assinaturaBiometrica?.verificada!==true;}
export function publicBiometrics(worker) { return Object.entries(worker.biometrias || {}).map(([fingerCode, value]) => ({ fingerCode, enrolledAt: value.enrolledAt })); }
function templateText(value) {
  if (typeof value !== 'string' || value.length < 40 || value.length > 120000 || /[\u0000-\u001f]/.test(value)) bad('O leitor não retornou um template biométrico válido.');
  return value;
}
function readProof(body, challenge, publicKey) {
  if (typeof body.proof !== 'string' || body.proof.length > 6000 || typeof body.proofSignature !== 'string' || body.proofSignature.length > 256) bad('A confirmação assinada do leitor está ausente. Atualize o JP Biometria.', 'BIOMETRIA_PROVA_AUSENTE');
  let proof, key;
  try {
    proof = JSON.parse(body.proof);
    if (typeof publicKey !== 'string' || publicKey.length > 500) throw new Error();
    key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || !verify('sha256', Buffer.from(body.proof), key, Buffer.from(body.proofSignature, 'base64'))) throw new Error();
  } catch { bad('A confirmação do leitor não pôde ser validada.', 'BIOMETRIA_PROVA_INVALIDA'); }
  if (proof.v !== 1 || proof.kind !== challenge.kind || proof.challengeId !== challenge.id || proof.workerId !== challenge.trabalhadorId || proof.fichaId !== challenge.fichaId || proof.fingerCode !== challenge.fingerCode) bad('A captura não corresponde ao trabalhador, dedo e ficha selecionados.', 'BIOMETRIA_DESTINO_DIVERGENTE');
  return proof;
}

export function createBiometricsService(store) {
  async function challenge({ worker, ficha = null, fingerCode, actor, kind }) {
    if (!fingerValid(fingerCode) || !['enroll','verify'].includes(kind)) bad('Selecione o dedo que será utilizado.');
    if (worker.status === 'Inativo') bad('O trabalhador está inativo.', 'TRABALHADOR_INATIVO', 409);
    let enrollment;
    if (kind === 'verify') {
      if (!signaturePending(ficha)) bad('A ficha não está pendente de assinatura.', 'FICHA_NAO_PENDENTE', 409);
      enrollment = await store.get('biometria', enrollmentId(worker, fingerCode));
      if (!enrollment || !worker.biometrias?.[fingerCode] || enrollment.id !== worker.biometrias[fingerCode].id) bad('Este dedo não está cadastrado. Cadastre a digital em Trabalhadores antes de assinar.', 'BIOMETRIA_NAO_CADASTRADA', 409);
    }
    const item = await store.create('biometria_desafio', {
      empresaId: worker.empresaId, trabalhadorId: worker.id, workerVersion: worker._version || 1,
      fichaId: ficha?.id || '', fichaVersion: ficha?._version || 0,
      fingerCode, kind, actor, expiresAtEpoch: Math.floor(Date.now()/1000)+300,
      enrollmentVersion: enrollment?._version || 0, enrollmentId: enrollment?.id || '', used: false
    });
    return { challengeId: item.id, workerId: worker.id, fichaId: item.fichaId, fingerCode, kind,
      ...(enrollment ? { template: enrollment.template, publicKey: enrollment.publicKey } : {}) };
  }
  async function complete({ body, worker, ficha = null, actor, kind }) {
    const challenge = await store.get('biometria_desafio', body.challengeId);
    if (!challenge || challenge.empresaId !== worker.empresaId || challenge.trabalhadorId !== worker.id || challenge.fichaId !== (ficha?.id || '') || challenge.actor !== actor || challenge.kind !== kind) bad('Inicie uma nova captura para este trabalhador.', 'BIOMETRIA_DESAFIO_INVALIDO', 403);
    const proofHash = hash(JSON.stringify([body.proof,body.proofSignature]));
    if (challenge.used) {
      if (challenge.proofHash !== proofHash) bad('Esta captura já foi utilizada.', 'BIOMETRIA_REUTILIZADA', 409);
      return { item: kind === 'verify' ? await store.get('ficha', ficha.id) : await store.get('trabalhador',worker.id), replayed: true };
    }
    if (challenge.expiresAtEpoch*1000 <= Date.now()) bad('A tentativa expirou. Capture novamente.', 'BIOMETRIA_EXPIRADA', 410);
    if ((worker._version || 1) !== challenge.workerVersion || ficha && ((ficha._version || 1) !== challenge.fichaVersion || !signaturePending(ficha))) bad('O cadastro ou a ficha mudou durante a captura. Atualize e tente novamente.', 'REGISTRO_ALTERADO', 409);
    const id = enrollmentId(worker, challenge.fingerCode);
    const previous = await store.get('biometria', id);
    const publicKey = kind === 'enroll' ? body.publicKey : previous?.publicKey;
    if (kind === 'verify' && (!previous || previous._version !== challenge.enrollmentVersion || previous.id !== challenge.enrollmentId)) bad('O cadastro biométrico foi alterado. Inicie novamente.', 'REGISTRO_ALTERADO', 409);
    const proof = readProof(body, challenge, publicKey);
    const template = kind === 'enroll' ? templateText(body.template) : previous.template;
    if (proof.templateHash !== hash(template)) bad('O template não corresponde ao cadastro selecionado.', 'BIOMETRIA_TEMPLATE_DIVERGENTE');
    const now = new Date().toISOString(), operations = [];
    if (kind === 'enroll') {
      if (proof.enrolled !== true) bad('O leitor não confirmou o cadastro.');
      const capture = body.fingerImageDataUrl ? validateCaptureImage(body.fingerImageDataUrl) : null;
      if (capture && proof.imageHash !== hash(capture.bytes) || !capture && proof.imageHash) bad('A imagem não corresponde ao cadastro capturado.', 'BIOMETRIA_IMAGEM_DIVERGENTE');
      operations.push({type:previous?'update':'create',entity:'biometria',id,...(previous?{expectedVersion:previous._version}:{}),data:{empresaId:worker.empresaId,trabalhadorId:worker.id,fingerCode:challenge.fingerCode,template,publicKey,imageDataUrl:capture?.dataUrl || "",enrolledAt:now,cadastradoPor:actor}});
      operations.push({type:'update',entity:'trabalhador',id:worker.id,expectedVersion:worker._version || 1,data:{biometrias:{...(worker.biometrias||{}),[challenge.fingerCode]:{id,enrolledAt:now}}}});
    } else {
      if (proof.matched !== true) bad('A digital não corresponde ao cadastro. A ficha continua sem assinatura.', 'BIOMETRIA_DIVERGENTE', 422);
      const capture = validateCaptureImage(body.fingerImageDataUrl);
      if (proof.imageHash !== hash(capture.bytes)) bad('A imagem não corresponde à captura verificada.', 'BIOMETRIA_IMAGEM_DIVERGENTE');
      if(ficha.assinaturaBiometrica)operations.push({type:'create',entity:'assinatura_anterior',id:randomUUID(),data:{empresaId:worker.empresaId,fichaId:ficha.id,assinaturaBiometrica:ficha.assinaturaBiometrica,substituidaEm:now,substituidaPor:actor}});
      operations.push({type:'update',entity:'ficha',id:ficha.id,expectedVersion:ficha._version || 1,data:{status:'assinada',assinaturaStatus:'verificada',dataAssinatura:now,assinaturaBiometrica:{id:randomUUID(),dedo:challenge.fingerCode,realFingerImage:capture.dataUrl,verificada:true,metodo:'NITGEN_VERIFY_MATCH',signedAt:now,capturadoPor:actor,challengeId:challenge.id,templateHash:proof.templateHash,proof:body.proof,proofSignature:body.proofSignature,publicKey}}});
      operations.push({type:'update',entity:'trabalhador',id:worker.id,expectedVersion:worker._version || 1,data:{ultimaAssinaturaEm:now}});
      // Pin the enrollment revision while signing: a concurrent re-enrollment must conflict.
      operations.push({type:'update',entity:'biometria',id,expectedVersion:previous._version,data:{ultimaVerificacao:now}});
    }
    operations.push({type:'update',entity:'biometria_desafio',id:challenge.id,expectedVersion:challenge._version,data:{used:true,proofHash}});
    const scope=workerScope(worker.empresaId), revision=await store.readScope(scope);
    await store.transact({scope,expectedRevision:revision,mutationId:`biometria:${challenge.id}`,operations});
    return {item:await store.get(kind==='enroll'?'trabalhador':'ficha',kind==='enroll'?worker.id:ficha.id),replayed:false};
  }
  async function gallery(worker) {
    const items = await Promise.all(Object.entries(worker.biometrias || {}).filter(([finger]) => fingerValid(finger)).map(async ([fingerCode, meta]) => {
      const item = await store.get('biometria', enrollmentId(worker, fingerCode));
      if (!item || item.id !== meta.id || item.empresaId !== worker.empresaId || item.trabalhadorId !== worker.id || item.fingerCode !== fingerCode) return null;
      return {fingerCode, enrolledAt:item.enrolledAt, imageDataUrl:item.imageDataUrl || ''};
    }));
    return items.filter(Boolean);
  }
  return {challenge,complete,gallery};
}
