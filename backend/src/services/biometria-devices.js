import {createHash,createPublicKey,verify,randomUUID} from 'node:crypto';
import {httpError} from '../middleware/auth.js';
const fail=(message,code='BIOMETRIA_DISPOSITIVO',status=403)=>{throw httpError(status,message,code);};
export function deviceKey(value){
 try{if(typeof value!=='string'||value.length>500)throw Error();const key=createPublicKey({key:Buffer.from(value,'base64'),type:'spki',format:'der'});if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error();return key.export({type:'spki',format:'der'}).toString('base64');}catch{fail('Identidade do agente biométrico inválida.','BIOMETRIA_DISPOSITIVO_INVALIDO',400);}
}
export const deviceId=(company,key)=>createHash('sha256').update(company+'\0'+deviceKey(key)).digest('hex');
export async function verificationDevice(store,company,requested,enrollmentKey){
 const key=deviceKey(requested||enrollmentKey),id=deviceId(company,key),device=await store.get('biometria_dispositivo',id);
 if(device&&(!device.active||device.empresaId!==company||device.publicKey!==key))fail('Este computador foi desautorizado para esta empresa.','BIOMETRIA_DISPOSITIVO_DESATIVADO');
 if(key!==enrollmentKey&&!device?.active)fail('O Master precisa autorizar este computador em Biometria uma única vez. A digital já cadastrada será preservada.','BIOMETRIA_DISPOSITIVO_NAO_AUTORIZADO');
 return {key,id,version:device?._version||0};
}
export function createDeviceService(store){
 const summary=item=>({id:item.id,name:item.name,active:item.active,authorizedAt:item.authorizedAt,version:item._version});
 return {
  async list(company){return (await store.list('biometria_dispositivo',company)).map(summary);},
  async start(company,actor,name){
   if(typeof name!=='string'||!name.trim()||name.length>80)fail('Informe um nome curto para este computador.','BIOMETRIA_DISPOSITIVO_NOME',400);
   const item=await store.create('biometria_dispositivo_desafio',{empresaId:company,actor,name:name.trim(),nonce:randomUUID(),expiresAtEpoch:Math.floor(Date.now()/1000)+300,used:false});
   return {v:1,kind:'device',companyId:company,challengeId:item.id,nonce:item.nonce,expiresAtEpoch:item.expiresAtEpoch};
  },
  async confirm(company,actor,id,body){
   const challenge=await store.get('biometria_dispositivo_desafio',id);
   if(!challenge||challenge.empresaId!==company||challenge.actor!==actor||challenge.used||challenge.expiresAtEpoch<=Date.now()/1000)fail('A autorização expirou. Inicie novamente.','BIOMETRIA_DISPOSITIVO_DESAFIO');
   const key=deviceKey(body.publicKey);let proof;
   try{if(typeof body.proof!=='string'||body.proof.length>2000||typeof body.proofSignature!=='string'||body.proofSignature.length>256)throw Error();proof=JSON.parse(body.proof);if(!verify('sha256',Buffer.from(body.proof),createPublicKey({key:Buffer.from(key,'base64'),type:'spki',format:'der'}),Buffer.from(body.proofSignature,'base64')))throw Error();}catch{fail('Não foi possível confirmar este agente.','BIOMETRIA_DISPOSITIVO_PROVA');}
   if(proof.v!==1||proof.kind!=='device'||proof.companyId!==company||proof.challengeId!==id||proof.nonce!==challenge.nonce||proof.expiresAtEpoch!==challenge.expiresAtEpoch)fail('A confirmação pertence a outra autorização.','BIOMETRIA_DISPOSITIVO_PROVA');
   const target=deviceId(company,key),previous=await store.get('biometria_dispositivo',target),scope='biometric-devices:'+company,revision=await store.readScope(scope);
   await store.transact({scope,expectedRevision:revision,mutationId:'authorize-device:'+id,operations:[{type:previous?'update':'create',entity:'biometria_dispositivo',id:target,...(previous?{expectedVersion:previous._version}:{}),data:{empresaId:company,publicKey:key,name:challenge.name,active:true,authorizedAt:new Date().toISOString(),authorizedBy:actor}},{type:'update',entity:'biometria_dispositivo_desafio',id,expectedVersion:challenge._version,data:{used:true}}]});
   return summary(await store.get('biometria_dispositivo',target));
  },
  async disable(company,actor,id,version){const item=await store.get('biometria_dispositivo',id);if(!item||item.empresaId!==company)fail('Computador não encontrado.','BIOMETRIA_DISPOSITIVO',404);if(!Number.isInteger(version))fail('Atualize a lista de computadores.','BIOMETRIA_DISPOSITIVO',409);return summary(await store.update('biometria_dispositivo',id,{active:false,disabledAt:new Date().toISOString(),disabledBy:actor},{expectedVersion:version}));}
 };
}
