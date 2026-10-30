// Package only for a temporary, IAM-invoked deployment check beside the bundled provider.
// Never expose as an application route; no employee data or face capture is used.
import {createPublicKey,verify} from 'node:crypto';
import {provider} from './provider.mjs';
export async function handler(){
 const privacy=await provider.privacyReady();if(!privacy)throw Error('AWS privacy not confirmed');
 const usage=await provider.quotaUsage();
 const proof='EntregaEPI deployment readiness 6970314; not a receipt or identity proof';
 const sealed=await provider.sign(proof);
 const pinned=JSON.parse(process.env.FACIAL_TRUSTED_KEYS)[sealed.keyArn];
 const verified=verify('sha256',Buffer.from(proof),createPublicKey({key:Buffer.from(pinned,'base64'),format:'der',type:'spki'}),Buffer.from(sealed.proofSignature,'base64'));
 if(!verified)throw Error('Evidence seal invalid');
 const credentials=await provider.credentials('deployment-readiness');
 if(!credentials.accessKeyId||!credentials.sessionToken)throw Error('Stream role unavailable');
 return {privacyReady:privacy,quotaReadable:Number.isInteger(usage.total),kmsSealVerified:verified,streamRoleAvailable:true};
}
