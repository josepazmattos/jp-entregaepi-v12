import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createStore} from '../src/db/store.js';
import {createBiometricsService,hash} from '../src/services/biometria.service.js';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const template='SYNTHETIC_TEMPLATE_NO_REAL_BIOMETRY_'.repeat(3),actor='same-company-login';
const pair=()=>{const p=generateKeyPairSync('ec',{namedCurve:'prime256v1'});return {...p,key:p.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
const proof=(p,data)=>{const proof=JSON.stringify(data);return {publicKey:p.key,proof,proofSignature:sign('sha256',Buffer.from(proof),p.privateKey).toString('base64')};};
const capture=(p,c,changes={})=>({...proof(p,{v:1,kind:c.kind,challengeId:c.challengeId,workerId:c.workerId,fichaId:c.fichaId,fingerCode:c.fingerCode,documentHash:c.documentHash,templateHash:hash(template),imageHash:hash(Buffer.from(PNG.split(',')[1],'base64')),...(c.kind==='enroll'?{enrolled:true}:{matched:true}),...changes}),template,challengeId:c.challengeId,fingerImageDataUrl:PNG});
async function fixture(){
 const store=createStore({allowMemory:true}),bio=createBiometricsService(store),a=pair(),b=pair(),company=await store.create('empresa',{nome:'SYNTHETIC COMPANY'});
 let worker=await store.create('trabalhador',{empresaId:company.id,nomeCompleto:'SYNTHETIC WORKER',status:'Ativo'});
 const ficha=await store.create('ficha',{empresaId:company.id,trabalhadorId:worker.id,status:'pendente',itens:[]});
 const c=await bio.challenge({worker,kind:'enroll',fingerCode:'R_INDEX',actor});await bio.complete({worker,kind:'enroll',actor,body:capture(a,c)});worker=await store.get('trabalhador',worker.id);
 const args={worker,ficha,actor,kind:'verify',fingerCode:'R_INDEX',devicePublicKey:b.key};
 return {store,bio,a,b,company,worker,ficha,args};
}
test('login da empresa usa cadastro existente em outro agente sem autorização manual, preservando template, identidade e imagem original',async()=>{
 const f=await fixture(),id=f.worker.biometrias.R_INDEX.id,before=await f.store.get('biometria',id);
 const c=await f.bio.challenge(f.args);assert.equal(c.template,template);assert.equal(c.publicKey,f.b.key);
 const result=await f.bio.complete({...f.args,body:capture(f.b,c)});assert.equal(result.item.status,'assinada');assert.equal(result.item.assinaturaBiometrica.publicKey,f.b.key);
 const after=await f.store.get('biometria',id);for(const key of ['template','publicKey','imageDataUrl','enrolledAt'])assert.equal(after[key],before[key]);
 assert.equal((await f.store.list('biometria_dispositivo')).length,0);
});
test('dedo sem cadastro, digital divergente e prova de outro agente não assinam',async()=>{
 const f=await fixture();await assert.rejects(f.bio.challenge({...f.args,fingerCode:'L_INDEX'}),{code:'BIOMETRIA_NAO_CADASTRADA'});
 const c=await f.bio.challenge(f.args);await assert.rejects(f.bio.complete({...f.args,body:capture(f.b,c,{matched:false})}),{code:'BIOMETRIA_DIVERGENTE'});
 await assert.rejects(f.bio.complete({...f.args,body:capture(f.a,c)}),{code:'BIOMETRIA_PROVA_INVALIDA'});
 assert.equal((await f.store.get('ficha',f.ficha.id)).status,'pendente');
});
test('alterar chave na resposta, dedo, ficha, conteúdo ou template não muda o desafio autorizado pela sessão',async()=>{
 const f=await fixture(),c=await f.bio.challenge(f.args);
 for(const change of [{fingerCode:'L_INDEX'},{fichaId:'another'},{documentHash:'0'.repeat(64)},{templateHash:'0'.repeat(64)}])await assert.rejects(f.bio.complete({...f.args,body:capture(f.b,c,change)}));
 await assert.rejects(f.bio.complete({...f.args,body:{...capture(f.a,c),publicKey:f.b.key}}),{code:'BIOMETRIA_PROVA_INVALIDA'});
 for(const value of [null,false,{},'', 'invalid',f.b.key.repeat(10)])await assert.rejects(f.bio.challenge({...f.args,devicePublicKey:value}),{code:'BIOMETRIA_AGENTE_INVALIDO'});
});
test('captura expirada ou de outra sessão não é aceita; reenvio idêntico não duplica assinatura',async()=>{
 const f=await fixture(),c=await f.bio.challenge(f.args),body=capture(f.b,c);
 await assert.rejects(f.bio.complete({...f.args,actor:'another-login',body}),{code:'BIOMETRIA_DESAFIO_INVALIDO'});
 await f.store.update('biometria_desafio',c.challengeId,{expiresAtEpoch:1});await assert.rejects(f.bio.complete({...f.args,body}),{code:'BIOMETRIA_EXPIRADA'});
 const fresh=await f.bio.challenge(f.args),response=capture(f.b,fresh);const first=await f.bio.complete({...f.args,body:response});const repeated=await f.bio.complete({...f.args,body:response});assert.equal(repeated.replayed,true);assert.equal(first.item._version,repeated.item._version);
});
test('agente antigo continua assinando no computador original, sem migração do cadastro',async()=>{
 const f=await fixture(),c=await f.bio.challenge({...f.args,devicePublicKey:undefined});assert.equal(c.publicKey,f.a.key);
 assert.equal((await f.bio.complete({...f.args,body:capture(f.a,c)})).item.status,'assinada');
});
