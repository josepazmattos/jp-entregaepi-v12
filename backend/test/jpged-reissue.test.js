import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync, createPrivateKey, sign, X509Certificate} from 'node:crypto';
import * as asn1 from 'asn1js';
import * as pki from 'pkijs';
import {PDFDocument} from 'pdf-lib';
import {createStore} from '../src/db/store.js';
import {createGedStorage} from '../src/db/jpged.js';
import {createGedService} from '../src/services/jpged.service.js';
import {detachedCms} from '../src/services/jpged-cms.js';
import {verifyCompanyCms} from '../src/services/jpged-pki.js';
import {documentHash, sha256} from '../src/services/document-integrity.js';
import {signingBytes} from '../src/services/jpged-pdf.js';
import {MODELO_FICHA_APROVADO} from '../src/services/ficha-modelo.js';

const dir=mkdtempSync(join(tmpdir(),'jpged-reissue-'));
after(()=>rmSync(dir,{recursive:true,force:true}));
execFileSync('python3',[new URL('./helpers/jpged-fixture.py',import.meta.url).pathname,dir]);
const key=createPrivateKey(readFileSync(join(dir,'pf.key'))),leaf=new X509Certificate(readFileSync(join(dir,'pf.pem')));
const chain=[leaf.raw.toString('base64'),readFileSync(join(dir,'root.der')).toString('base64')];
const root=new pki.Certificate({schema:asn1.fromBER(readFileSync(join(dir,'root.der'))).result});
const validate=(cms,content,target)=>verifyCompanyCms(cms,content,target,{roots:[root],loadCrl:async()=>readFileSync(join(dir,'fresh.crl'))});
const sample=Buffer.from('synthetic configuration'),challenge=detachedCms(sample,chain);
const checked=await validate(challenge.complete(sign('sha256',challenge.signedBytes,key)),sample,'12345678000195');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function fixture(){
  const store=createStore({allowMemory:true}),ged=createGedStorage({memory:true});
  const company=await store.create('empresa',{nome:'EMPRESA SINTÉTICA',cnpj:'12345678000195'});
  const cert=await ged.put(company.id,'CERT','current',{...checked.certificate,active:true,mode:'vault',keyArn:'test-only',chain,target:{companyId:company.id,registrationType:'CNPJ',registrationNumber:company.cnpj},authorizationPath:'synthetic'});
  let ficha=await store.create('ficha',{empresaId:company.id,trabalhadorId:'worker',trabalhadorNome:'COLABORADOR SINTÉTICO',numero:'TEST-REISSUE',status:'assinada',empresaSnapshot:{...company,logoDataUrl:PNG},trabalhadorSnapshot:{nomeCompleto:'COLABORADOR SINTÉTICO',cpf:'00000000000'},modeloFicha:MODELO_FICHA_APROVADO,tipo:'Entrega e Devolução',data:'10/10/2026',itens:[{quantidade:1,epiNome:'Capacete',ca:'365',datasMovimentacao:{entrega:'10/10/2026'}},{quantidade:2,epiNome:'Uniforme',semCA:true,datasMovimentacao:{devolucao:'10/10/2026'}}]});
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const proof=JSON.stringify({documentHash:documentHash(ficha),fichaId:ficha.id,workerId:'worker',matched:true,kind:'verify',fingerCode:'R_INDEX',imageHash:sha256(Buffer.from(PNG.split(',')[1],'base64'))});
  ficha=await store.update('ficha',ficha.id,{assinaturaBiometrica:{id:'bio-original',verificada:true,dedo:'R_INDEX',realFingerImage:PNG,signedAt:'2026-10-10T10:00:00Z',proof,proofSignature:sign('sha256',Buffer.from(proof),pair.privateKey).toString('base64'),publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}});
  let signCalls=0,onSign=async()=>{};
  const vault={sign:async(arn,bytes)=>{signCalls++;await onSign();return sign('sha256',bytes,key);}};
  const service=createGedService({ged,store,validate,vault}),job=await service.prepare(ficha,'actor');
  await service.certify(company.id,'actor',job.jobId);
  const modern=await ged.get(company.id,'DOC',ficha.id),{layoutVersion,...old}=modern;
  const document=await ged.put(company.id,'DOC',ficha.id,old,modern.version);
  ficha=await store.get('ficha',ficha.id);signCalls=0;
  return {store,ged,service,company,cert,document,ficha,get signCalls(){return signCalls;},setOnSign:fn=>onSign=fn};
}
test('reemissão preserva original, dados, prova e data biométrica; novo PDF tem CMS verificável e uma página',async()=>{
  const f=await fixture(),original=await f.ged.readBlob(f.document.path);
  const result=await f.service.reissueLayout(f.company.id,'actor',f.document.id);
  assert.ok(result.completed);assert.equal(f.signCalls,1);
  assert.deepEqual(await f.ged.get(f.company.id,'DOC',f.document.id),f.document);
  assert.deepEqual(await f.ged.readBlob(f.document.path),original);
  assert.deepEqual(await f.store.get('ficha',f.ficha.id),f.ficha);
  const revision=await f.ged.get(f.company.id,'LAYOUT',f.document.id),pdf=await f.ged.readBlob(revision.path);
  assert.notEqual(revision.path,f.document.path);assert.equal(revision.sourcePdfHash,sha256(original));
  assert.equal((await PDFDocument.load(pdf)).getPageCount(),1);
  const range=/\/ByteRange \[0 (\d+) (\d+) (\d+)\]/.exec(pdf.toString('latin1'));
  const start=Number(range[1]),end=Number(range[2]),padded=Buffer.from(pdf.subarray(start+1,end-1).toString(),'hex');
  const parsed=asn1.fromBER(padded),cms=padded.subarray(0,parsed.offset);
  assert.equal((await validate(cms,signingBytes(pdf,start,end),f.cert.target)).certificate.fingerprint,f.cert.fingerprint);
  const evidence=JSON.parse((await f.ged.readBlob(revision.evidencePath)).toString());
  assert.equal(evidence.biometricAt,f.document.biometricAt);assert.equal(evidence.sourcePdfHash,f.document.pdfHash);
  assert.equal(evidence.documentHash,documentHash(f.ficha));assert.ok(evidence.validation.crls.length);
  assert.equal((await f.service.download(f.company.id,'actor',f.document.id)).sha256,revision.pdfHash);
  assert.equal((await f.service.download(f.company.id,'actor',f.document.id,{original:true})).sha256,f.document.pdfHash);
  const listed=(await f.service.documents(f.company.id)).items[0];assert.equal(listed.compactRevision.pdfHash,revision.pdfHash);
  assert.equal(listed.compactRevision.path,undefined);assert.equal(listed.compactRevision.certificate,undefined);
  assert.equal((await f.service.reissueLayout(f.company.id,'other-session',f.document.id)).alreadyCurrent,true);assert.equal(f.signCalls,1);
});
test('sessões simultâneas convergem para uma versão publicada',async()=>{
  const f=await fixture();let released;const wait=new Promise(r=>released=r);let calls=0;
  f.setOnSign(async()=>{if(++calls===2)released();await wait;});
  const results=await Promise.all(['a','b'].map(actor=>f.service.reissueLayout(f.company.id,actor,f.document.id)));
  assert.equal(results[0].revision.pdfHash,results[1].revision.pdfHash);
  assert.equal((await f.ged.list(f.company.id,'LAYOUT')).items.length,1);
  assert.deepEqual(await f.store.get('ficha',f.ficha.id),f.ficha);
});
test('empresa diferente não pode atualizar ou consultar o documento',async()=>{
  const f=await fixture();await assert.rejects(f.service.reissueLayout('other','actor',f.document.id),{code:'JPGED_DOCUMENTO'});
  assert.equal(f.signCalls,0);assert.equal((await f.service.documents('other')).items.length,0);
});
for(const scenario of ['conteudo','cancelamento','prova','imagem','biometricId','pdfHash','certificado-vencido','certificado-local','certificado-ausente','falha-cofre','mudanca-certificado','mudanca-durante-assinatura']){
  test('bloqueio seguro: '+scenario,async()=>{
    const f=await fixture(),bio=f.ficha.assinaturaBiometrica;
    if(scenario==='conteudo')await f.store.update('ficha',f.ficha.id,{itens:[]});
    if(scenario==='cancelamento')await f.store.update('ficha',f.ficha.id,{status:'cancelada'});
    if(scenario==='prova')await f.store.update('ficha',f.ficha.id,{assinaturaBiometrica:{...bio,proof:'{}'}});
    if(scenario==='imagem')await f.store.update('ficha',f.ficha.id,{assinaturaBiometrica:{...bio,realFingerImage:'invalid'}});
    if(scenario==='biometricId')await f.store.update('ficha',f.ficha.id,{assinaturaBiometrica:{...bio,id:'changed'}});
    if(scenario==='pdfHash')await f.ged.put(f.company.id,'DOC',f.document.id,{...f.document,pdfHash:'f'.repeat(64)},f.document.version);
    if(scenario.startsWith('certificado-'))await f.ged.put(f.company.id,'CERT','current',{...f.cert,...(scenario==='certificado-vencido'?{validTo:'2020-01-01'}:scenario==='certificado-local'?{mode:'local'}:{active:false})},f.cert.version);
    if(scenario==='falha-cofre')f.setOnSign(async()=>{throw Error('Synthetic unavailable');});
    if(scenario==='mudanca-certificado')f.setOnSign(()=>f.ged.put(f.company.id,'CERT','current',{...f.cert,active:false},f.cert.version));
    if(scenario==='mudanca-durante-assinatura')f.setOnSign(()=>f.store.update('ficha',f.ficha.id,{itens:[]}));
    await assert.rejects(f.service.reissueLayout(f.company.id,'actor',f.document.id));
    assert.equal(await f.ged.get(f.company.id,'LAYOUT',f.document.id),null);
    assert.ok((await f.service.download(f.company.id,'actor',f.document.id,{original:true})).url);
  });
}
test('nova ficha já marcada como compacta dispensa reemissão',async()=>{
  const f=await fixture();await f.ged.put(f.company.id,'DOC',f.document.id,{...f.document,layoutVersion:'compact-1'},f.document.version);
  assert.equal((await f.service.reissueLayout(f.company.id,'actor',f.document.id)).alreadyCurrent,true);assert.equal(f.signCalls,0);
});
