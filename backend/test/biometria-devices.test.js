import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createStore} from '../src/db/store.js';
import {createDeviceService} from '../src/services/biometria-devices.js';
import {createBiometricsService,hash} from '../src/services/biometria.service.js';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const template='SYNTHETIC_TEMPLATE_NO_REAL_BIOMETRY_'.repeat(3),actor='same-company-login';
const pair=()=>{const p=generateKeyPairSync('ec',{namedCurve:'prime256v1'});return {...p,key:p.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
const proof=(p,data)=>{const proof=JSON.stringify(data);return {publicKey:p.key,proof,proofSignature:sign('sha256',Buffer.from(proof),p.privateKey).toString('base64')};};
const capture=(p,c,changes={})=>({...proof(p,{v:1,kind:c.kind,challengeId:c.challengeId,workerId:c.workerId,fichaId:c.fichaId,fingerCode:c.fingerCode,documentHash:c.documentHash,templateHash:hash(template),imageHash:hash(Buffer.from(PNG.split(',')[1],'base64')),...(c.kind==='enroll'?{enrolled:true}:{matched:true}),...changes}),template,challengeId:c.challengeId,fingerImageDataUrl:PNG});
async function fixture(){
 const store=createStore({allowMemory:true}),devices=createDeviceService(store),bio=createBiometricsService(store),a=pair(),b=pair(),company=await store.create('empresa',{nome:'SYNTHETIC COMPANY'});
 let worker=await store.create('trabalhador',{empresaId:company.id,nomeCompleto:'SYNTHETIC WORKER',status:'Ativo'});
 const ficha=await store.create('ficha',{empresaId:company.id,trabalhadorId:worker.id,status:'pendente',itens:[]});
 const c=await bio.challenge({worker,kind:'enroll',fingerCode:'R_INDEX',actor});await bio.complete({worker,kind:'enroll',actor,body:capture(a,c)});worker=await store.get('trabalhador',worker.id);
 const args={worker,ficha,actor,kind:'verify',fingerCode:'R_INDEX',devicePublicKey:b.key};
 const authorize=async(companyId=company.id,p=b)=>{const c=await devices.start(companyId,'MASTER','SYNTHETIC PC');return devices.confirm(companyId,'MASTER',c.challengeId,proof(p,c));};
 return {store,devices,bio,a,b,company,worker,ficha,args,authorize};
}
test('cadastro existente funciona em outro agente autorizado, preservando template, identidade e imagem original',async()=>{
 const f=await fixture(),id=f.worker.biometrias.R_INDEX.id,before=await f.store.get('biometria',id);
 await assert.rejects(f.bio.challenge(f.args),{code:'BIOMETRIA_DISPOSITIVO_NAO_AUTORIZADO'});
 await f.authorize();const c=await f.bio.challenge(f.args);assert.equal(c.template,template);assert.equal(c.publicKey,f.b.key);
 const result=await f.bio.complete({...f.args,body:capture(f.b,c)});assert.equal(result.item.status,'assinada');assert.equal(result.item.assinaturaBiometrica.publicKey,f.b.key);
 const after=await f.store.get('biometria',id);for(const key of ['template','publicKey','imageDataUrl','enrolledAt'])assert.equal(after[key],before[key]);
 assert.equal((await f.devices.list('OTHER-COMPANY')).length,0);
});
test('autorização de outra empresa, dedo sem cadastro, digital divergente e prova de outro agente não assinam',async()=>{
 const f=await fixture();await f.authorize('OTHER-COMPANY');await assert.rejects(f.bio.challenge(f.args),{code:'BIOMETRIA_DISPOSITIVO_NAO_AUTORIZADO'});
 await f.authorize();await assert.rejects(f.bio.challenge({...f.args,fingerCode:'L_INDEX'}),{code:'BIOMETRIA_NAO_CADASTRADA'});
 const c=await f.bio.challenge(f.args);await assert.rejects(f.bio.complete({...f.args,body:capture(f.b,c,{matched:false})}),{code:'BIOMETRIA_DIVERGENTE'});
 await assert.rejects(f.bio.complete({...f.args,body:capture(f.a,c)}),{code:'BIOMETRIA_PROVA_INVALIDA'});
 assert.equal((await f.store.get('ficha',f.ficha.id)).status,'pendente');
});
test('desautorização bloqueia tentativa em andamento e novos desafios sem apagar cadastros',async()=>{
 const f=await fixture(),device=await f.authorize(),c=await f.bio.challenge(f.args);
 await f.devices.disable(f.company.id,'MASTER',device.id,device.version);
 await assert.rejects(f.bio.challenge(f.args),{code:'BIOMETRIA_DISPOSITIVO_DESATIVADO'});
 await assert.rejects(f.bio.complete({...f.args,body:capture(f.b,c)}),{code:'BIOMETRIA_DISPOSITIVO_DESATIVADO'});
 assert.equal((await f.store.get('biometria',f.worker.biometrias.R_INDEX.id)).template,template);
});
test('autorizações exigem nonce, ator, validade e assinatura corretos e são de uso único',async()=>{
 const f=await fixture(),c=await f.devices.start(f.company.id,'MASTER','PC'),p=proof(f.b,c);
 await assert.rejects(f.devices.confirm(f.company.id,'OTHER',c.challengeId,p));
 await assert.rejects(f.devices.confirm(f.company.id,'MASTER',c.challengeId,proof(f.b,{...c,nonce:'wrong'})));
 await assert.rejects(f.devices.confirm(f.company.id,'MASTER',c.challengeId,{...p,publicKey:f.a.key}));
 await f.devices.confirm(f.company.id,'MASTER',c.challengeId,p);await assert.rejects(f.devices.confirm(f.company.id,'MASTER',c.challengeId,p));
 const expired=await f.devices.start(f.company.id,'MASTER','PC');await f.store.update('biometria_dispositivo_desafio',expired.challengeId,{expiresAtEpoch:1});await assert.rejects(f.devices.confirm(f.company.id,'MASTER',expired.challengeId,proof(f.b,expired)));
});
test('agente antigo continua assinando no computador original, sem migração do cadastro',async()=>{
 const f=await fixture(),c=await f.bio.challenge({...f.args,devicePublicKey:undefined});assert.equal(c.publicKey,f.a.key);
 assert.equal((await f.bio.complete({...f.args,body:capture(f.a,c)})).item.status,'assinada');
});
