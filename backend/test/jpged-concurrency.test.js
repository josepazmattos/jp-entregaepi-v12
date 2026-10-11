import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,createPrivateKey,sign,X509Certificate} from 'node:crypto';
import * as asn1 from 'asn1js';import * as pki from 'pkijs';
import {createStore} from '../src/db/store.js';import {createGedStorage} from '../src/db/jpged.js';
import {createGedService} from '../src/services/jpged.service.js';import {createBiometricsService,hash} from '../src/services/biometria.service.js';
import {detachedCms} from '../src/services/jpged-cms.js';import {verifyCompanyCms} from '../src/services/jpged-pki.js';import {documentHash,sha256} from '../src/services/document-integrity.js';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const imageHash=sha256(Buffer.from(PNG.split(',')[1],'base64'));
test('o mesmo login certifica oito fichas simultâneas com uma chave de cofre e provas de agentes distintos',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jpged-concurrency-'));
 try{
  execFileSync('python3',[new URL('./helpers/jpged-fixture.py',import.meta.url).pathname,dir]);
  const key=createPrivateKey(readFileSync(join(dir,'pf.key'))),leaf=new X509Certificate(readFileSync(join(dir,'pf.pem'))),chain=[leaf.raw.toString('base64'),readFileSync(join(dir,'root.der')).toString('base64')],root=new pki.Certificate({schema:asn1.fromBER(readFileSync(join(dir,'root.der'))).result});
  const validate=(cms,content,target)=>verifyCompanyCms(cms,content,target,{roots:[root],loadCrl:async()=>readFileSync(join(dir,'fresh.crl'))});
  const store=createStore({allowMemory:true}),ged=createGedStorage({memory:true}),company=await store.create('empresa',{nome:'EMPRESA SINTÉTICA',cnpj:'12345678000195'}),actor='SAME-COMPANY-LOGIN';let active=0,peak=0,calls=0;
  const vault={sign:async(arn,bytes)=>{assert.equal(arn,'synthetic-vault');active++;calls++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));try{return sign('sha256',bytes,key);}finally{active--;}}};
  const service=createGedService({ged,store,validate,vault}),sample=Buffer.from('synthetic configuration'),cms=detachedCms(sample,chain),checked=await validate(cms.complete(sign('sha256',cms.signedBytes,key)),sample,company.cnpj);
  await ged.put(company.id,'CERT','current',{...checked.certificate,active:true,mode:'vault',keyArn:'synthetic-vault',chain,target:{companyId:company.id,registrationType:'CNPJ',registrationNumber:company.cnpj},authorizationPath:'synthetic-only'});
  const fichas=[];
  for(let i=0;i<8;i++){
   const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});let ficha=await store.create('ficha',{empresaId:company.id,trabalhadorId:'worker-'+i,trabalhadorNome:'COLABORADOR SINTÉTICO '+i,numero:'SYNTHETIC-'+i,status:'assinada',tipo:'Entrega',data:'10/10/2026',itens:[{quantidade:i+1,epiNome:'Capacete',ca:'365',datasMovimentacao:{entrega:'10/10/2026'}}]});
   const proof=JSON.stringify({documentHash:documentHash(ficha),fichaId:ficha.id,workerId:ficha.trabalhadorId,matched:true,kind:'verify',fingerCode:'R_INDEX',imageHash});
   ficha=await store.update('ficha',ficha.id,{assinaturaBiometrica:{id:'bio-'+i,verificada:true,dedo:'R_INDEX',realFingerImage:PNG,signedAt:new Date().toISOString(),proof,proofSignature:sign('sha256',Buffer.from(proof),pair.privateKey).toString('base64'),publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}});fichas.push(ficha);
  }
  const jobs=await Promise.all(fichas.map(f=>service.prepare(f,actor))),results=await Promise.all(jobs.map(j=>service.certify(company.id,actor,j.jobId)));
  assert.ok(peak>1);assert.equal(calls,8);assert.equal(new Set(results.map(r=>r.documentId)).size,8);
  for(let i=0;i<8;i++){assert.equal(results[i].completed,true);const current=await store.get('ficha',fichas[i].id),doc=await ged.get(company.id,'DOC',current.certificacao.documentId);assert.equal(doc.documentHash,documentHash(fichas[i]));assert.equal(doc.certificate.fingerprint,checked.certificate.fingerprint);assert.deepEqual(current.assinaturaBiometrica,fichas[i].assinaturaBiometrica);}
  assert.equal((await service.documents('OTHER-COMPANY')).items.length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('limitação atual: confirmações biométricas simultâneas na mesma empresa podem exigir nova tentativa',async()=>{
 const store=createStore({allowMemory:true}),bio=createBiometricsService(store),company=await store.create('empresa',{nome:'SYNTHETIC'}),actor='SAME-COMPANY-LOGIN',template='SYNTHETIC_TEMPLATE_NOT_REAL_'.repeat(3),items=[];
 function attest(challenge,pair){const proof=JSON.stringify({v:1,kind:challenge.kind,challengeId:challenge.challengeId,workerId:challenge.workerId,fichaId:challenge.fichaId,fingerCode:challenge.fingerCode,documentHash:challenge.documentHash,templateHash:hash(template),imageHash,...(challenge.kind==='enroll'?{enrolled:true}:{matched:true})});return {challengeId:challenge.challengeId,template,publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),fingerImageDataUrl:PNG,proof,proofSignature:sign('sha256',Buffer.from(proof),pair.privateKey).toString('base64')};}
 for(let i=0;i<2;i++){const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});let worker=await store.create('trabalhador',{empresaId:company.id,nomeCompleto:'WORKER '+i,status:'Ativo'});const ficha=await store.create('ficha',{empresaId:company.id,trabalhadorId:worker.id,status:'pendente',itens:[]});const c=await bio.challenge({worker,fingerCode:'R_INDEX',actor,kind:'enroll'});await bio.complete({worker,actor,kind:'enroll',body:attest(c,pair)});worker=await store.get('trabalhador',worker.id);const challenge=await bio.challenge({worker,ficha,fingerCode:'R_INDEX',actor,kind:'verify'});items.push({worker,ficha,actor,kind:'verify',body:attest(challenge,pair)});}
 const results=await Promise.allSettled(items.map(item=>bio.complete(item)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const failed=results.findIndex(r=>r.status==='rejected');assert.equal(results[failed].reason.code,'REGISTRO_ALTERADO');
 assert.equal((await store.get('ficha',items[failed].ficha.id)).status,'pendente');assert.equal((await bio.complete(items[failed])).item.status,'assinada');
});
