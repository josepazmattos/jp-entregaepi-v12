import {createPublicKey} from 'node:crypto';
import {httpError} from '../middleware/auth.js';

// The authenticated company session authorizes access to the enrollment.
// This public key binds one capture proof to the agent selected for that attempt.
// Older agents omit their key and retain compatibility with the original machine.
export function verificationKey(requested, enrollmentKey) {
  const value = requested === undefined ? enrollmentKey : requested;
  try {
    if (typeof value !== 'string' || !value || value.length > 500) throw Error();
    const key = createPublicKey({key:Buffer.from(value,'base64'), type:'spki', format:'der'});
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error();
    return key.export({type:'spki',format:'der'}).toString('base64');
  } catch {
    throw httpError(400,'O agente não informou uma identidade válida. Verifique a conexão local.','BIOMETRIA_AGENTE_INVALIDO');
  }
}
