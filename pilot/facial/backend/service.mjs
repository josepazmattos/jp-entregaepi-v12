import { createHash, randomUUID } from 'node:crypto';

export const NOTICE_VERSION = 'JP-FACIAL-PILOTO-2026-10-30-v1';
export const RECEIPT_TEXT = 'Confirmo, exclusivamente neste teste, os equipamentos e quantidades apresentados nesta ficha. Este documento não registra uma entrega real de EPI.';
export const POLICY = Object.freeze({ liveness: 98, similarity: 99.5, version: 'PILOTO-1-NAO-CALIBRADO' });
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonical(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function text(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(400, 'INVALID_INPUT', `${label}: informe um texto válido.`);
  return value.trim();
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) fail(400, 'INVALID_ID', 'Identificador inválido. Inicie uma nova tentativa.');
  return value;
}
export function publicRecord(record) {
  const { pk, sk, owner, referenceKey, referenceVersion, ...safe } = record;
  return safe;
}
export function createService({ store, provider, images, clock = () => Date.now(), endAt, enabled = true }) {
  const now = () => new Date(clock()).toISOString();
  const expires = () => Math.floor(clock()/1000) + 7*86400;
  const active = () => { if (!enabled || !Number.isFinite(Date.parse(endAt)) || clock() >= Date.parse(endAt)) fail(403, 'PILOT_CLOSED', 'A etapa de capturas deste piloto está encerrada.'); };
  async function enrollment(owner, id) {
    const item = await store.get(owner, 'ENROLL#' + uuid(id));
    if (!item || item.state !== 'ACTIVE' || item.expiresAtEpoch <= clock()/1000) fail(409, 'ENROLLMENT_REQUIRED', 'Cadastre novamente o rosto deste participante.');
    return item;
  }
  function consent(body) {
    if (body.noticeVersion !== NOTICE_VERSION || body.voluntary !== true) fail(400, 'CONSENT_REQUIRED', 'O participante deve ler e aceitar o aviso específico deste teste.');
  }
  function input(body) {
    consent(body);
    if (body.kind === 'ENROLL') {
      if (body.identityChecked !== true) fail(400, 'IDENTITY_CHECK_REQUIRED', 'O responsável deve conferir a identidade antes do cadastro.');
      return { kind: 'ENROLL', name: text(body.name, 'Nome ou identificação do participante'), company: text(body.company, 'Empresa de teste'), identityChecked: true, noticeVersion: NOTICE_VERSION, voluntary: true };
    }
    if (body.kind !== 'VERIFY' || body.method !== 'FACIAL') fail(400, 'METHOD_REQUIRED', 'Este módulo aceita somente o método facial. A digital permanece no aplicativo atual.');
    if (body.receiptAccepted !== true) fail(400, 'RECEIPT_REQUIRED', 'Confira os itens e confirme a ficha de teste.');
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) fail(400, 'ITEMS_REQUIRED', 'Inclua de 1 a 20 itens.');
    const items = body.items.map(item => {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) fail(400, 'INVALID_QUANTITY', 'Informe uma quantidade inteira de 1 a 1000.');
      const ca = String(item.ca ?? '').trim();
      if (ca && !/^\d{1,8}$/.test(ca)) fail(400, 'INVALID_CA', 'O CA deve conter somente números.');
      return { description: text(item.description, 'Equipamento'), quantity: item.quantity, ca };
    });
    return { kind: 'VERIFY', method: 'FACIAL', enrollmentId: uuid(body.enrollmentId), items, receiptAccepted: true, statement: RECEIPT_TEXT, noticeVersion: NOTICE_VERSION, voluntary: true };
  }
  async function begin(owner, body) {
    active();
    const id = uuid(body.requestId), request = input(body), requestHash = digest(request);
    let item = await store.get(owner, 'ATTEMPT#' + id);
    if (item) {
      if (item.requestHash !== requestHash || item.state !== 'READY' || item.sessionExpiresAt <= clock()) fail(409, 'ATTEMPT_USED', 'Esta tentativa não pode ser reutilizada. Inicie outra.');
    } else {
      const source = request.kind === 'VERIFY' ? await enrollment(owner, request.enrollmentId) : null;
      const snapshot = source ? { ...request, name: source.name, company: source.company, enrollmentVersion: source.id, enrollmentReferenceHash: source.referenceHash } : request;
      item = { owner, id, type: 'ATTEMPT', sk: 'ATTEMPT#' + id, state: 'CREATING', requestHash, snapshot, contentHash: digest(snapshot), createdAt: now(), expiresAtEpoch: expires(), policy: POLICY };
      // Atomic quota and attempt reservation; repeated or parallel requests cannot bypass the cap.
      await store.reserve(item, { day: now().slice(0,10), totalLimit: 50, dailyLimit: 20 });
      try {
        const session = await provider.create({ token: digest(owner + '\n' + id) });
        if (!session.sessionId) fail(503, 'PROVIDER_UNAVAILABLE', 'Não foi possível abrir a verificação facial.');
        item = await store.change(owner, item.sk, 'CREATING', { state: 'READY', sessionId: session.sessionId, sessionExpiresAt: clock() + 175000, providerCreateRequestId: session.requestId || null });
      } catch (error) {
        await store.change(owner, item.sk, 'CREATING', { state: 'FAILED', failureCode: 'CREATE_FAILED' }).catch(() => {});
        throw error;
      }
    }
    const credentials = await provider.credentials(item.id);
    return { attemptId: item.id, sessionId: item.sessionId, expiresAt: item.sessionExpiresAt, contentHash: item.contentHash, snapshot: item.snapshot, credentials, region: 'sa-east-1' };
  }
  async function complete(owner, body) {
    const id = uuid(body.attemptId), sk = 'ATTEMPT#' + id;
    let attempt = await store.get(owner, sk);
    if (!attempt || attempt.expiresAtEpoch <= clock()/1000) fail(404, 'NOT_FOUND', 'Tentativa não encontrada.');
    if (body.contentHash !== attempt.contentHash) fail(409, 'CONTENT_CHANGED', 'O conteúdo mudou. Inicie uma nova confirmação.');
    if (attempt.state === 'APPROVED') {
      const record = await store.get(owner, attempt.resultKey);
      if (!record) fail(409, 'RESULT_UNAVAILABLE', 'O registro não está mais disponível.');
      return { approved: true, record: publicRecord(record) };
    }
    if (attempt.state !== 'READY') fail(409, 'ATTEMPT_USED', 'Tentativa encerrada ou em processamento. Atualize a lista.');
    if (attempt.sessionExpiresAt <= clock()) fail(409, 'SESSION_EXPIRED', 'A sessão expirou. Inicie outra captura.');
    attempt = await store.change(owner, sk, 'READY', { state: 'PROCESSING' });
    let savedImage;
    try {
      const live = await provider.result(attempt.sessionId);
      if (['CREATED','IN_PROGRESS'].includes(live.status)) {
        await store.change(owner, sk, 'PROCESSING', { state: 'READY' });
        return { pending: true };
      }
      const proof = { provider: 'AWS_REKOGNITION', sessionId: attempt.sessionId, createRequestId: attempt.providerCreateRequestId, resultRequestId: live.requestId || null, providerStatus: live.status, livenessScore: Number.isFinite(live.confidence) ? live.confidence : null, challenge: live.challenge || null, feedback: live.feedback || [], thresholds: POLICY, verifiedAt: now() };
      if (live.status !== 'SUCCEEDED' || !Number.isFinite(live.confidence) || live.confidence < POLICY.liveness || !live.image?.length) {
        await store.change(owner, sk, 'PROCESSING', { state: 'REJECTED', proof, failureCode: 'LIVENESS_NOT_APPROVED' });
        return { approved: false, code: 'LIVENESS_NOT_APPROVED', message: 'A prova de vida não atingiu o critério deste teste. Ajuste a iluminação e tente novamente.' };
      }
      const faceCount = await provider.countFaces(live.image);
      if (faceCount !== 1) {
        await store.change(owner, sk, 'PROCESSING', { state: 'REJECTED', proof, failureCode: 'FACE_COUNT' });
        return { approved: false, code: 'FACE_COUNT', message: 'A captura deve mostrar apenas um rosto. Faça uma nova tentativa.' };
      }
      let source = null;
      if (attempt.snapshot.kind === 'VERIFY') {
        source = await enrollment(owner, attempt.snapshot.enrollmentId);
        if (source.referenceHash !== attempt.snapshot.enrollmentReferenceHash) fail(409, 'ENROLLMENT_CHANGED', 'O cadastro foi alterado. Inicie novamente.');
        const reference = await images.get(source.referenceKey, source.referenceVersion);
        if (digest(reference) !== source.referenceHash) fail(409, 'REFERENCE_INTEGRITY', 'Não foi possível confirmar a integridade do cadastro.');
        const comparison = await provider.compare(reference, live.image);
        proof.comparison = { similarity: comparison.similarity ?? null, requestId: comparison.requestId || null, faceCount: comparison.faceCount };
        if (!Number.isFinite(comparison.similarity) || comparison.similarity < POLICY.similarity || comparison.faceCount !== 1) {
          await store.change(owner, sk, 'PROCESSING', { state: 'REJECTED', proof, failureCode: 'FACE_NOT_CONFIRMED' });
          return { approved: false, code: 'FACE_NOT_CONFIRMED', message: 'O rosto não foi confirmado para este cadastro. Confira o participante e solicite revisão.' };
        }
      }
      savedImage = await images.put(owner, id, live.image);
      const recordId = randomUUID(), type = source ? 'RECEIPT' : 'ENROLL';
      const record = { owner, id: recordId, sk: type + '#' + recordId, type, state: source ? 'CONFIRMED_TEST' : 'ACTIVE', testOnly: true, icpSigned: false, name: attempt.snapshot.name, company: attempt.snapshot.company, method: 'FACIAL', createdAt: now(), expiresAtEpoch: expires(), contentHash: attempt.contentHash, snapshot: attempt.snapshot, proof, referenceHash: digest(live.image), referenceKey: savedImage.key, referenceVersion: savedImage.version || null, operatorId: owner, noticeVersion: NOTICE_VERSION };
      record.evidenceHash = digest(publicRecord(record));
      await store.finish(attempt, record, source);
      return { approved: true, record: publicRecord(record) };
    } catch (error) {
      if (savedImage) await images.remove(savedImage.key, savedImage.version).catch(() => {});
      await store.change(owner, sk, 'PROCESSING', { state: 'FAILED', failureCode: error.code || 'VERIFICATION_FAILED' }).catch(() => {});
      throw error;
    }
  }
  async function cancel(owner, id) {
    const sk = 'ATTEMPT#' + uuid(id), item = await store.get(owner, sk);
    if (!item) return { cancelled: true };
    if (['CREATING','READY','PROCESSING'].includes(item.state)) await store.change(owner, sk, item.state, { state: 'CANCELLED' });
    return { cancelled: item.state !== 'APPROVED' };
  }
  async function list(owner) {
    return (await store.list(owner)).filter(i => ['ENROLL','RECEIPT'].includes(i.type) && i.expiresAtEpoch > clock()/1000).map(publicRecord).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function record(owner, type, id) {
    if (!['ENROLL','RECEIPT'].includes(type)) fail(400, 'INVALID_TYPE', 'Tipo inválido.');
    const item = await store.get(owner, type + '#' + uuid(id));
    if (!item || item.expiresAtEpoch <= clock()/1000) fail(404, 'NOT_FOUND', 'Documento não encontrado ou expirado.');
    return publicRecord(item);
  }
  async function clear(owner) {
    const all = await store.list(owner);
    // Revoke sources first, preventing an in-flight verification from committing.
    for (const item of all.filter(i => i.type === 'ENROLL' && i.state === 'ACTIVE')) await store.change(owner, item.sk, 'ACTIVE', { state: 'REVOKED' });
    for (const item of all.filter(i => i.type === 'ATTEMPT')) await cancel(owner,item.id).catch(() => {});
    for (const item of all) {
      if (item.referenceKey) await images.remove(item.referenceKey, item.referenceVersion);
      await store.remove(owner,item.sk);
    }
    return { deleted: all.length };
  }
  return { begin, complete, cancel, list, record, clear };
}
