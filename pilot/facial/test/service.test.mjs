import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {createService,NOTICE_VERSION,digest} from '../backend/service.mjs';
import {makePdf} from '../backend/pdf.mjs';
import {PDFDocument} from 'pdf-lib';

function fixture(){
  let time=Date.parse('2026-10-30T12:00:00Z'),count=0;
  const data=new Map(),pictures=new Map(),calls={create:0,result:0,compare:0};
  const k=(owner,sk)=>owner+'|'+sk;
  const store={
    async get(o,s){return structuredClone(data.get(k(o,s)));},
    async list(o){return [...data.values()].filter(v=>v.owner===o).map(v=>structuredClone(v));},
    async reserve(item){if(count>=50||data.has(k(item.owner,item.sk)))throw Object.assign(Error('Conflict'),{code:'CONFLICT_OR_LIMIT'});count++;data.set(k(item.owner,item.sk),structuredClone(item));},
    async change(o,s,state,patch){const old=data.get(k(o,s));if(!old||old.state!==state)throw Object.assign(Error('Conflict'),{code:'CONFLICT'});const next={...old,...patch};data.set(k(o,s),next);return structuredClone(next);},
    async finish(attempt,record,source){const old=data.get(k(attempt.owner,attempt.sk));if(old?.state!=='PROCESSING'||source&&data.get(k(source.owner,source.sk))?.state!=='ACTIVE')throw Object.assign(Error('Conflict'),{code:'CONFLICT'});data.set(k(attempt.owner,attempt.sk),{...old,state:'APPROVED',resultKey:record.sk});data.set(k(record.owner,record.sk),structuredClone(record));},
    async remove(o,s){data.delete(k(o,s));}
  };
  const results={live:99.8,similarity:99.9,faces:1,status:'SUCCEEDED'};
  const provider={
    async create(){calls.create++;return {sessionId:randomUUID(),requestId:'create-request'};},
    async credentials(){return {accessKeyId:'SYNTHETIC_ONLY',secretAccessKey:'not-an-aws-key',sessionToken:'not-an-aws-token',expiration:'2026-10-30T12:15:00Z'};},
    async result(){calls.result++;return {status:results.status,confidence:results.live,image:Buffer.from('SYNTHETIC IMAGE ONLY'),challenge:{Type:'FaceMovementAndLightChallenge',Version:'1.0.0'},requestId:'result-request'};},
    async countFaces(){return results.faces;},
    async compare(){calls.compare++;return {similarity:results.similarity,faceCount:results.faces,requestId:'comparison-request'};}
  };
  const images={
    async put(owner,id,bytes){const key=owner+'/'+id;pictures.set(key,Buffer.from(bytes));return {key,version:'1'};},
    async get(key){return pictures.get(key);},
    async remove(key){pictures.delete(key);}
  };
  const api=createService({store,provider,images,clock:()=>time,endAt:'2026-11-06T23:59:59Z'});
  const enrollBody=()=>({requestId:randomUUID(),kind:'ENROLL',name:'PARTICIPANTE FICTÍCIO',company:'EMPRESA DE TESTE',noticeVersion:NOTICE_VERSION,voluntary:true,identityChecked:true});
  const enroll=async()=>{const session=await api.begin('master-a',enrollBody());return (await api.complete('master-a',{attemptId:session.attemptId,contentHash:session.contentHash})).record;};
  const verifyBody=id=>({requestId:randomUUID(),kind:'VERIFY',method:'FACIAL',enrollmentId:id,items:[{description:'Capacete',quantity:1,ca:'12345'}],receiptAccepted:true,voluntary:true,noticeVersion:NOTICE_VERSION});
  return {api,store,provider,results,calls,data,pictures,images,enrollBody,enroll,verifyBody,advance:ms=>time+=ms};
}
test('requires voluntary informed participation and supervised identity check',async()=>{
  const f=fixture();for(const patch of [{voluntary:false},{noticeVersion:'old'},{identityChecked:false}])await assert.rejects(()=>f.api.begin('master-a',{...f.enrollBody(),...patch}));assert.equal(f.calls.create,0);
});
test('does not require or call any fingerprint method to enroll',async()=>{const f=fixture(),r=await f.enroll();assert.equal(r.type,'ENROLL');assert.equal(r.method,'FACIAL');assert.equal(r.icpSigned,false);assert.equal(r.proof.livenessScore,99.8);assert(!('referenceKey'in r));assert(!('owner'in r));});
test('verifies a receipt against enrollment and binds items and explicit acknowledgment',async()=>{
  const f=fixture(),enroll=await f.enroll(),s=await f.api.begin('master-a',f.verifyBody(enroll.id)),r=await f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash});
  assert(r.approved);assert.equal(r.record.type,'RECEIPT');assert.equal(r.record.snapshot.items[0].quantity,1);assert.equal(r.record.snapshot.receiptAccepted,true);assert.equal(r.record.contentHash,digest(r.record.snapshot));assert.equal(f.calls.compare,1);assert(r.record.testOnly);
});
test('rejects changed method, absent acknowledgment and invalid quantities',async()=>{const f=fixture(),e=await f.enroll();for(const patch of [{method:'DIGITAL'},{receiptAccepted:false},{items:[{description:'Item',quantity:0}]}])await assert.rejects(()=>f.api.begin('master-a',{...f.verifyBody(e.id),...patch}));});
test('rejects tampering with document hash',async()=>{const f=fixture(),s=await f.api.begin('master-a',f.enrollBody());await assert.rejects(()=>f.api.complete('master-a',{attemptId:s.attemptId,contentHash:'forged'}),{code:'CONTENT_CHANGED'});assert.equal(f.calls.result,0);});
test('isolates master users, attempts, enrollment and documents',async()=>{const f=fixture(),e=await f.enroll();assert.deepEqual(await f.api.list('master-b'),[]);await assert.rejects(()=>f.api.begin('master-b',f.verifyBody(e.id)),{code:'ENROLLMENT_REQUIRED'});await assert.rejects(()=>f.api.record('master-b','ENROLL',e.id),{code:'NOT_FOUND'});});
test('expired sessions cannot be approved',async()=>{const f=fixture(),s=await f.api.begin('master-a',f.enrollBody());f.advance(180000);await assert.rejects(()=>f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash}),{code:'SESSION_EXPIRED'});assert.equal(f.calls.result,0);});
test('low liveness never creates an enrollment',async()=>{const f=fixture();f.results.live=60;const s=await f.api.begin('master-a',f.enrollBody()),r=await f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash});assert.equal(r.approved,false);assert.deepEqual(await f.api.list('master-a'),[]);assert.equal(f.pictures.size,0);});
test('low similarity never creates a receipt',async()=>{const f=fixture(),e=await f.enroll();f.results.similarity=50;const s=await f.api.begin('master-a',f.verifyBody(e.id)),r=await f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash});assert.equal(r.code,'FACE_NOT_CONFIRMED');assert.equal((await f.api.list('master-a')).length,1);});
test('multiple faces are refused before identity comparison',async()=>{const f=fixture();f.results.faces=2;const s=await f.api.begin('master-a',f.enrollBody()),r=await f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash});assert.equal(r.code,'FACE_COUNT');assert.equal(f.pictures.size,0);});
test('repeating completion returns the same record without repeating provider calls',async()=>{const f=fixture(),s=await f.api.begin('master-a',f.enrollBody()),body={attemptId:s.attemptId,contentHash:s.contentHash},a=await f.api.complete('master-a',body),b=await f.api.complete('master-a',body);assert.equal(a.record.id,b.record.id);assert.equal(f.calls.result,1);});
test('cancelled attempt cannot be approved',async()=>{const f=fixture(),s=await f.api.begin('master-a',f.enrollBody());await f.api.cancel('master-a',s.attemptId);await assert.rejects(()=>f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash}),{code:'ATTEMPT_USED'});assert.equal(f.calls.result,0);});
test('concurrent completion commits only one document',async()=>{const f=fixture(),s=await f.api.begin('master-a',f.enrollBody()),body={attemptId:s.attemptId,contentHash:s.contentHash};await Promise.allSettled([f.api.complete('master-a',body),f.api.complete('master-a',body)]);assert.equal((await f.api.list('master-a')).length,1);assert.equal(f.calls.result,1);});
test('revocation while provider is processing prevents commit and removes captured image',async()=>{const f=fixture(),e=await f.enroll(),s=await f.api.begin('master-a',f.verifyBody(e.id)),original=f.provider.compare;f.provider.compare=async(...args)=>{await f.store.change('master-a','ENROLL#'+e.id,'ACTIVE',{state:'REVOKED'});return original(...args);};await assert.rejects(()=>f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash}));assert.equal((await f.api.list('master-a')).filter(r=>r.type==='RECEIPT').length,0);assert.equal(f.pictures.size,1);});
test('checks reference image integrity before comparing faces',async()=>{const f=fixture(),e=await f.enroll();for(const key of f.pictures.keys())f.pictures.set(key,Buffer.from('altered'));const s=await f.api.begin('master-a',f.verifyBody(e.id));await assert.rejects(()=>f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash}),{code:'REFERENCE_INTEGRITY'});assert.equal(f.calls.compare,0);});
test('idempotent start does not create another session or accept changed content',async()=>{const f=fixture(),body=f.enrollBody(),a=await f.api.begin('master-a',body),b=await f.api.begin('master-a',body);assert.equal(a.sessionId,b.sessionId);assert.equal(f.calls.create,1);await assert.rejects(()=>f.api.begin('master-a',{...body,name:'Changed'}),{code:'ATTEMPT_USED'});});
test('provider failures cannot leave an approved record',async()=>{const f=fixture(),s=await f.api.begin('master-a',f.enrollBody());f.provider.result=async()=>{throw Error('Provider unavailable');};await assert.rejects(()=>f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash}));assert.equal((await f.api.list('master-a')).length,0);});
test('expired enrollments and expired pilot block new captures',async()=>{const f=fixture(),e=await f.enroll();f.advance(8*86400000);await assert.rejects(()=>f.api.begin('master-a',f.verifyBody(e.id)),{code:'PILOT_CLOSED'});assert.deepEqual(await f.api.list('master-a'),[]);});
test('clear removes only the current operator test records and images',async()=>{const f=fixture();await f.enroll();await f.api.begin('master-b',f.enrollBody());await f.api.clear('master-a');assert.deepEqual(await f.api.list('master-a'),[]);assert.equal(f.pictures.size,0);assert.equal((await f.store.list('master-b')).length,1);});
test('exports printable test PDFs without an ICP signature',async()=>{const f=fixture(),e=await f.enroll(),s=await f.api.begin('master-a',f.verifyBody(e.id)),r=(await f.api.complete('master-a',{attemptId:s.attemptId,contentHash:s.contentHash})).record;await mkdir('out',{recursive:true});for(const [name,record,evidence]of[['cadastro',e,false],['ficha',r,false],['evidencias',r,true]]){const bytes=await makePdf(record,evidence);const doc=await PDFDocument.load(bytes);assert(doc.getPageCount()>=1);assert(doc.getTitle().includes('TESTE'));assert.equal(doc.getForm().getFields().length,0);await writeFile(`out/${name}.pdf`,bytes);}});
