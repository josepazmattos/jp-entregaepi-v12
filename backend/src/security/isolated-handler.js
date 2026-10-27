import { verifyToken, mfaSessions, isMaster, requireVerifiedMaster, securityEvent } from './session.js';
import { httpError } from '../middleware/auth.js';
import { gedStorage } from '../db/jpged.js';
import * as store from '../db/store.js';
import { createGedService } from '../services/jpged.service.js';
import { createV10Destination } from '../services/v10-destination.js';
const service = createGedService({ ged: gedStorage, store });
const destination = createV10Destination({ ged: gedStorage });
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function createIsolatedHandler({ mode, verify = verifyToken, sessions = mfaSessions, database = store, gedService = service, log = securityEvent } = {}) {
  return async event => {
    let actor, company;
    try {
      if (!event || !id(event.company) || typeof event.action !== 'string') throw httpError(400, 'Solicitação inválida.', 'SECURITY_REQUEST');
      const claims = await verify(event.token); actor = claims.sub; company = event.company;
      const master = isMaster(claims);
      if (master) await requireVerifiedMaster(event.token, claims, { recent: mode === 'admin' && event.action !== 'destination', sessions });
      else if (mode === 'admin' || !claims['cognito:groups']?.includes('EMPRESA') || claims['custom:empresa_id'] !== company) throw httpError(403, 'Acesso não permitido a esta empresa.', 'EMPRESA_NAO_AUTORIZADA');
      const employer = await database.get('empresa', company);
      const historicalRead = master && mode === 'signer' && ['certificate','download'].includes(event.action);
      if (!employer || (employer.excluidaEm && !historicalRead)) throw httpError(403, 'Empresa indisponível.', 'EMPRESA_EXCLUIDA');
      let data;
      if (mode === 'signer') {
        if (!['certificate','prepare','certify','layout','download'].includes(event.action)) throw httpError(403, 'Operação não permitida no assinador.', 'SIGNER_ACTION');
        if (Object.keys(event).some(k => !['token','action','company','id',...(event.action==='download'?['original']:[])].includes(k))) throw httpError(400, 'O assinador recebe apenas a identificação da ficha.', 'SIGNER_PAYLOAD');
        if (event.action === 'certificate') data = await gedService.certificate(company);
        else {
          if (!id(event.id)) throw httpError(400, 'Identificação inválida.', 'SIGNER_ID');
          if (event.action === 'prepare') {
            const ficha = await database.get('ficha', event.id);
            if (!ficha || ficha.empresaId !== company || ficha.canceladaEm || ficha.excluidaEm) throw httpError(403, 'Ficha não autorizada.', 'EMPRESA_NAO_AUTORIZADA');
            data = await gedService.prepare(ficha, actor);
          } else if (event.action === 'download') {
            if(typeof event.original!=='boolean')throw httpError(400,'Versão inválida.','JPGED_VERSAO');
            data=await gedService.download(company,actor,event.id,{original:event.original});
          } else if (event.action === 'certify') data = await gedService.certify(company, actor, event.id);
          else data = await gedService.reissueLayout(company, actor, event.id);
        }
      } else if (mode === 'admin') {
        if (!['start','prove','complete','cancel','disconnect','destination'].includes(event.action)) throw httpError(403, 'Operação não permitida no cofre.', 'VAULT_ACTION');
        if (Object.keys(event).some(k => !['token','action','company','id','body'].includes(k))) throw httpError(400, 'Solicitação inválida.', 'VAULT_PAYLOAD');
        const allowed = { start: ['chain'], prove: ['signature'], complete: ['wrappedKey'], cancel: [], disconnect: [], destination:['destinationId','version'] }[event.action];
        const body = event.body || {};
        if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw httpError(400, 'O cofre não recebe arquivos A1 ou senhas.', 'VAULT_PAYLOAD');
        if (event.action === 'destination') data = await destination.save(employer, actor, body);
        else if (event.action === 'start') data = await gedService.vaultAdmin.start(employer, actor, body);
        else if (event.action === 'disconnect') { await gedService.disconnect(company, actor); data = {}; }
        else {
          if (!id(event.id)) throw httpError(400, 'Identificação inválida.', 'VAULT_ID');
          data = await gedService.vaultAdmin[event.action](employer, actor, event.id, body);
          // Administration never needs kms:Sign or returns internal key references.
          if (event.action === 'complete') data = { installed: true };
        }
      } else throw httpError(503, 'Serviço de segurança não configurado.', 'SECURITY_MODE');
      log(mode === 'signer' ? 'SIGNER_OPERATION' : 'VAULT_OPERATION', 'success', { actor, company, operation: event.action });
      return { ok: true, data: data ?? {} };
    } catch (error) {
      log(mode === 'signer' ? 'SIGNER_OPERATION' : 'VAULT_OPERATION', 'denied', { actor, company, operation: event?.action, code: error.code || error.name });
      const status = error.status || 503;
      return { ok: false, status, code: error.code || 'SEGURANCA_INDISPONIVEL', error: error.status ? error.message : 'O serviço de assinatura não concluiu a operação. Tente novamente.' };
    }
  };
}
export const signerHandler = createIsolatedHandler({ mode: 'signer' });
export const adminHandler = createIsolatedHandler({ mode: 'admin' });
