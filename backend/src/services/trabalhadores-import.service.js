import { createHash, randomUUID } from 'node:crypto';
import { httpError } from '../middleware/auth.js';
import { buildWorkerImport, publicImport, findWorkerIdentity, requireValidWorker, normalizeCPF, foldIdentity, WORKER_COLUMNS } from './trabalhadores.service.js';
import { decodeXlsx, readWorkerXlsx } from './trabalhadores-xlsx.service.js';

export const WORKER_BATCH_LIMIT = 80;
const manifestEntity = 'trabalhador_importacao';
const chunkEntity = 'trabalhador_importacao_lote';
export const workerScope = empresaId => `trabalhadores:${empresaId}`;
const chunkId = (id, index) => `${id}:${index}`;
const conflicts = new Set(['REGISTRO_ALTERADO', 'ESCOPO_ALTERADO', 'CONCORRENCIA_CONFLITO', 'TRANSACAO_CONFLITO']);

export function splitWorkerImport(plan) {
  const byLine = new Map(plan.writes.map(write => {
    const { linha, ...operation } = write;
    return [linha, operation];
  }));
  const chunks = [];
  let current = { linhas: [], operations: [] };
  for (const report of plan.linhas) {
    const operation = byLine.get(report.linha);
    const next = { linhas: [...current.linhas, report], operations: operation ? [...current.operations, operation] : current.operations };
    if (current.linhas.length && (next.linhas.length > WORKER_BATCH_LIMIT || Buffer.byteLength(JSON.stringify(next)) > 240 * 1024)) {
      chunks.push(current);
      current = { linhas: [report], operations: operation ? [operation] : [] };
    } else current = next;
  }
  if (current.linhas.length) chunks.push(current);
  return chunks;
}

export function createWorkerImportService(store, { clock = () => new Date() } = {}) {
  async function manifestFor(id, empresaId, actor) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw httpError(404, 'Importação não encontrada.', 'IMPORTACAO_NAO_ENCONTRADA');
    const manifest = await store.get(manifestEntity, id);
    if (!manifest || manifest.empresaId !== empresaId || manifest.autorSub !== actor) throw httpError(404, 'Importação não encontrada para este acesso e empresa.', 'IMPORTACAO_NAO_ENCONTRADA');
    return manifest;
  }

  async function present(manifest) {
    const chunks = await Promise.all(Array.from({ length: manifest.lotesTotal }, (_, index) => store.get(chunkEntity, chunkId(manifest.id, index))));
    if (chunks.some(chunk => !chunk || chunk.empresaId !== manifest.empresaId || chunk.autorSub !== manifest.autorSub)) throw httpError(409, 'A prévia está incompleta. Envie novamente a planilha.', 'IMPORTACAO_INCOMPLETA');
    const item = { ...manifest, linhas: chunks.flatMap(chunk => chunk.linhas) };
    const expired = ['pendente', 'em_andamento'].includes(item.status) && new Date(item.expiresAt).getTime() <= clock().getTime();
    return {
      ...publicImport(item),
      ...(expired ? { status: 'expirada', podeConfirmar: false } : {}),
      processados: item.processados || 0,
      total: item.resumo.total,
      lotesConcluidos: item.nextChunk || 0,
      lotesTotal: item.lotesTotal,
      ...(item.status === 'concluida' ? { confirmedAt: item.updatedAt } : {}),
      ...(item.erro ? { aviso: item.erro } : {})
    };
  }

  async function preview({ arquivoNome, arquivoBase64, empresaId, actor }) {
    const bytes = decodeXlsx(arquivoBase64, arquivoNome);
    const rows = await readWorkerXlsx(bytes);
    const scope = workerScope(empresaId);
    const snapshot = await store.listWithRevision('trabalhador', empresaId, scope);
    const plan = buildWorkerImport({ rows, existing: snapshot.items, empresaId, actor, now: clock() });
    const chunks = splitWorkerImport(plan);
    const id = randomUUID();
    const { linhas, writes, ...details } = plan;
    const manifest = {
      ...details,
      arquivoNome: arquivoNome.replace(/^.*[\\/]/, '').trim(),
      arquivoSha256: createHash('sha256').update(bytes).digest('hex'),
      expectedRevision: snapshot.revision,
      nextChunk: 0,
      lotesTotal: chunks.length,
      processados: 0,
      expiresAtEpoch: Math.floor(new Date(plan.expiresAt).getTime() / 1000) + 86400
    };
    await store.transact({
      scope: `trabalhadores-importacao:${id}`,
      expectedRevision: 0,
      mutationId: 'previa',
      operations: [
        { type: 'create', entity: manifestEntity, id, data: manifest },
        ...chunks.map((chunk, index) => ({ type: 'create', entity: chunkEntity, id: chunkId(id, index), data: { ...chunk, empresaId, autorSub: actor, importacaoId: id, index, expiresAt: plan.expiresAt, expiresAtEpoch: manifest.expiresAtEpoch } }))
      ],
      result: { importacaoId: id }
    });
    return present(await store.get(manifestEntity, id));
  }

  async function getProgress({ id, empresaId, actor }) {
    return present(await manifestFor(id, empresaId, actor));
  }

  async function confirm({ id, empresaId, actor }) {
    const manifest = await manifestFor(id, empresaId, actor);
    if (manifest.status === 'concluida') return present(manifest);
    if (!['pendente', 'em_andamento'].includes(manifest.status) || !manifest.podeConfirmar) {
      const error = httpError(409, 'Esta prévia não pode ser sincronizada. Corrija os avisos e envie novamente a planilha.', 'IMPORTACAO_BLOQUEADA');
      error.importacao = await present(manifest);
      throw error;
    }
    if (new Date(manifest.expiresAt).getTime() <= clock().getTime()) {
      const error = httpError(409, 'A prévia expirou. Envie novamente a planilha para conferir o cadastro atual. Os lotes já sincronizados foram preservados.', 'IMPORTACAO_EXPIRADA');
      error.importacao = await present(manifest);
      throw error;
    }
    const chunk = await store.get(chunkEntity, chunkId(id, manifest.nextChunk));
    if (!chunk || chunk.empresaId !== empresaId || chunk.autorSub !== actor) throw httpError(409, 'A prévia está incompleta. Envie novamente a planilha.', 'IMPORTACAO_INCOMPLETA');
    const nextChunk = manifest.nextChunk + 1;
    const finished = nextChunk === manifest.lotesTotal;
    try {
      await store.transact({
        scope: workerScope(empresaId),
        expectedRevision: manifest.expectedRevision,
        mutationId: `importacao:${id}:lote:${manifest.nextChunk}`,
        operations: [
          ...chunk.operations,
          { type: 'update', entity: manifestEntity, id, expectedVersion: manifest._version, data: {
            expectedRevision: manifest.expectedRevision + 1,
            nextChunk,
            processados: manifest.processados + chunk.linhas.length,
            status: finished ? 'concluida' : 'em_andamento',
            podeConfirmar: !finished
          } }
        ],
        result: { importacaoId: id, nextChunk }
      });
    } catch (error) {
      if (error.code === 'TRANSACAO_OCUPADA' || error.status === 503) {
        // Temporary contention does not invalidate the approved preview.
        // Return its durable progress when reads are available so the browser can resume.
        try { error.importacao = await present(await manifestFor(id, empresaId, actor)); }
        catch { /* Keep the original recoverable error if storage reads are also unavailable. */ }
        throw error;
      }
      if (!conflicts.has(error.code)) throw error;
      // Another request may have committed this same batch while this browser was waiting.
      const latest = await manifestFor(id, empresaId, actor);
      if (latest.nextChunk > manifest.nextChunk) return present(latest);
      const message = 'O cadastro mudou após a prévia. Os lotes já sincronizados foram preservados; o restante não foi aplicado. Envie novamente a planilha para conferir as alterações.';
      let blocked = latest;
      try { blocked = await store.update(manifestEntity, id, { status: 'conflito', podeConfirmar: false, erro: message }, { expectedVersion: latest._version }); }
      catch (blockingError) {
        if (!conflicts.has(blockingError.code)) throw blockingError;
        blocked = await manifestFor(id, empresaId, actor);
        if (blocked.nextChunk > manifest.nextChunk) return present(blocked);
      }
      const conflict = httpError(409, message, 'IMPORTACAO_DESATUALIZADA');
      conflict.importacao = await present(blocked);
      throw conflict;
    }
    return present(await manifestFor(id, empresaId, actor));
  }

  async function createWorker({ body, empresaId, actor }) {
    const data = requireValidWorker(body, { strictCPF: false });
    const scope = workerScope(empresaId);
    for (let attempt = 0; attempt < 4; attempt++) {
      const snapshot = await store.listWithRevision('trabalhador', empresaId, scope);
      const match = findWorkerIdentity(data, snapshot.items);
      if (match.error) throw httpError(409, match.error, 'TRABALHADOR_IDENTIDADE_CONFLITO');
      if (match.item) return { item: match.item, reutilizado: true };
      const id = randomUUID();
      try {
        await store.transact({ scope, expectedRevision: snapshot.revision, mutationId: `cadastro:${id}`, operations: [
          { type: 'create', entity: 'trabalhador', id, data: { ...data, status: data.status || 'Ativo', empresaId, criadoPor: actor } }
        ], result: { id } });
        return { item: await store.get('trabalhador', id), reutilizado: false };
      } catch (error) { if (!conflicts.has(error.code) || attempt === 3) throw error; }
    }
  }
  async function editWorker({body,worker,actor}) {
    if (!Number.isSafeInteger(body._version) || body._version !== (worker._version || 1)) throw httpError(409,'O cadastro foi alterado. Atualize e tente novamente.','REGISTRO_ALTERADO');
    const data=requireValidWorker({...worker,...body},{strictCPF:false});
    for(const column of WORKER_COLUMNS)if(!column.required && body[column.key] === '')data[column.key]='';
    if (body.empresaId && body.empresaId !== worker.empresaId) throw httpError(403,'O vínculo da empresa não pode ser alterado.','EMPRESA_DIVERGENTE');
    if (normalizeCPF(data.cpf) !== normalizeCPF(worker.cpf) && Object.keys(worker.biometrias||{}).length) throw httpError(409,'O CPF identifica um trabalhador com biometria cadastrada. Cadastre outra pessoa separadamente.','IDENTIDADE_BIOMETRICA_VINCULADA');
    const scope=workerScope(worker.empresaId), snapshot=await store.listWithRevision('trabalhador',worker.empresaId,scope);
    if(snapshot.items.some(item=>item.id!==worker.id && (normalizeCPF(item.cpf)===normalizeCPF(data.cpf)||foldIdentity(item.matriculaESocial)===foldIdentity(data.matriculaESocial)))) throw httpError(409,'CPF ou matrícula já utilizado nesta empresa.','TRABALHADOR_IDENTIDADE_CONFLITO');
    await store.transact({scope,expectedRevision:snapshot.revision,mutationId:`edicao:${randomUUID()}`,operations:[{type:'update',entity:'trabalhador',id:worker.id,expectedVersion:body._version,data:{...data,atualizadoPor:actor}}]});
    return {item:await store.get('trabalhador',worker.id)};
  }
  return { preview, getProgress, confirm, createWorker, editWorker };
}
