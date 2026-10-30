import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {createStore} from '../src/db/store.js';
import {createFacialService} from '../src/services/facial.service.js';
import {verifyFacialProof,FACIAL_NOTICE_ID} from '../src/services/facial-proof.js';
import {modeloFichaParaItens} from '../src/services/ficha-modelo.js';
import {documentHash} from '../src/services/document-integrity.js';
async function fixture(){
 const store=createStore({allowMemory:true}),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),keyArn='synthetic-key',publicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),images=new Map(),sessions=new Set();
 let now=Date.parse('2026-10-30T12:00:00Z');const config={enabled:true,privacyReady:true,endAt:'2026-11-06T11:32:46Z'},state={live:100,similarity:100,faces:1,calls:0};
 const provider={reserveQuota:async(_,id)=>{sessions.add(id);},create:async()=>({sessionId:randomUUID()}),credentials:async()=>({synthetic:true}),result:async()=>{state.calls++;return {status:'SUCCEEDED',confidence:state.live,image:Buffer.from('SYNTHETIC IMAGE')};},countFaces:async()=>state.faces,compare:async()=>({similarity:state.similarity,faceCount:1}),putImage:async(_,id,bytes)=>{images.set(id,bytes);return {key:id,version:'v1'};},getImage:async id=>images.get(id),removeImage:async id=>images.delete(id),sign:async proof=>({keyArn,publicKey,proofSignature:sign('sha256',Buffer.from(proof),pair.privateKey).toString('base64')})};
 const service=createFacialService({store,provider,settings:()=>config,clock:()=>now});
 const company=await store.create('empresa',{nome:'SINTÉTICA'});let worker=await store.create('trabalhador',{empresaId:company.id,nomeCompleto:'SINTÉTICO',cpf:'00000000000',status:'Ativo'});
 let ficha=await store.create('ficha',{empresaId:company.id,trabalhadorId:worker.id,status:'pendente',itens:[{quantidade:1,epiNome:'Capacete',ca:'123'}],modeloFicha:modeloFichaParaItens()});
 const args=async(kind='verify',body={})=>({worker:await store.get('trabalhador',worker.id),ficha:kind==='verify'?await store.get('ficha',ficha.id):null,kind,actor:'synthetic-actor',body:{requestId:randomUUID(),noticeId:FACIAL_NOTICE_ID,cienciaDados:true,identidadeConferida:true,aceiteTermo:true,termoAssinaturaId:ficha.modeloFicha.termoAssinaturaId,...body}});
 const enroll=async()=>{const a=await args('enroll'),s=await service.begin(a);return service.complete({...a,body:{attemptId:s.attemptId}});};
 return {store,service,provider,args,enroll,config,state,images,sessions,worker,ficha,pair,keys:{[keyArn]:publicKey},advance:ms=>now+=ms};
}
test('cadastro não assina: ficha permanece pendente; nova captura facial vincula conteúdo, aceite e selo e suporta reenvio',async()=>{
 const f=await fixture();await f.enroll();assert.equal((await f.store.get('ficha',f.ficha.id)).status,'pendente');
 const a=await f.args(),s=await f.service.begin(a),again=await f.service.begin(a);assert.equal(s.attemptId,again.attemptId);assert.equal(f.sessions.size,2);
 const result=await f.service.complete({...a,body:{attemptId:s.attemptId}});assert.equal(result.item.status,'assinada');assert.equal(verifyFacialProof(result.item,f.keys),documentHash(f.ficha));assert.equal(result.item.assinaturaBiometrica.aceiteTermo.metodo,'FACIAL');assert.equal(result.item.assinaturaBiometrica.realFingerImage,undefined);
 const replay=await f.service.complete({...await f.args(),body:{attemptId:s.attemptId}});assert.equal(replay.replayed,true);assert.equal(replay.item._version,result.item._version);assert.equal(f.state.calls,2);
});
test('não captura sem ficha gerada, cadastro, aceite exato ou ciência; privacidade e prazo bloqueiam início',async()=>{
 const f=await fixture();await assert.rejects(f.service.begin(await f.args()),{code:'FACIAL_CADASTRO_PENDENTE'});await f.enroll();
 for(const body of [{aceiteTermo:false},{termoAssinaturaId:'outro'}])await assert.rejects(f.service.begin(await f.args('verify',body)),{code:'ASSINATURA_ACEITE_OBRIGATORIO'});
 await assert.rejects(f.service.begin(await f.args('verify',{cienciaDados:false})),{code:'FACIAL_AVISO_OBRIGATORIO'});
 await assert.rejects(f.service.begin({...await f.args(),ficha:null}),{code:'FICHA_NAO_PENDENTE'});
 f.config.privacyReady=false;await assert.rejects(f.service.begin(await f.args()),{code:'FACIAL_INDISPONIVEL'});f.config.privacyReady=true;f.advance(8*86400000);assert.equal(f.service.status().enabled,false);
});
for(const [name,changes,code] of [['prova de vida insuficiente',{live:97.9},'FACIAL_PROVA_VIDA_REPROVADA'],['rosto divergente',{similarity:99.4},'FACIAL_DIVERGENTE'],['mais de um rosto',{faces:2},'FACIAL_ROSTO_UNICO']])test(name+' não assina nem grava evidência aprovada',async()=>{
 const f=await fixture();await f.enroll();Object.assign(f.state,changes);const a=await f.args(),s=await f.service.begin(a);await assert.rejects(f.service.complete({...a,body:{attemptId:s.attemptId,matched:true,similarity:100}}),{code});assert.equal((await f.store.get('ficha',f.ficha.id)).status,'pendente');assert.equal(f.images.size,1);
});
test('cancelamento, expiração, outro ator e outra empresa não confirmam',async()=>{
 const f=await fixture();await f.enroll();const a=await f.args(),s=await f.service.begin(a),body={attemptId:s.attemptId};
 await assert.rejects(f.service.complete({...a,actor:'outro',body}),{code:'FACIAL_TENTATIVA_INVALIDA'});await assert.rejects(f.service.complete({...a,worker:{...a.worker,empresaId:'outra'},body}),{code:'FACIAL_TENTATIVA_INVALIDA'});
 await f.service.cancel({...a,body});await assert.rejects(f.service.complete({...a,body}),{code:'FACIAL_TENTATIVA_USADA'});
 const next=await f.service.begin(await f.args());f.advance(180000);await assert.rejects(f.service.complete({...await f.args(),body:{attemptId:next.attemptId}}),{code:'FACIAL_TENTATIVA_USADA'});
});
test('alterar ficha ou recadastrar rosto invalida captura anterior',async()=>{
 for(const target of ['ficha','rosto']){const f=await fixture();await f.enroll();const a=await f.args(),s=await f.service.begin(a);if(target==='ficha')await f.store.update('ficha',f.ficha.id,{itens:[]});else await f.enroll();await assert.rejects(f.service.complete({...await f.args(),body:{attemptId:s.attemptId}}),{code:'REGISTRO_ALTERADO'});}
});
test('digital confirmada enquanto câmera valida impede segunda assinatura; imagem órfã é removida',async()=>{
 const f=await fixture();await f.enroll();const a=await f.args(),s=await f.service.begin(a),original=f.provider.compare;
 f.provider.compare=async(...args)=>{await f.store.update('ficha',f.ficha.id,{status:'assinada',assinaturaBiometrica:{id:'existing-digital',metodo:'NITGEN_VERIFY_MATCH',verificada:true}});return original(...args);};
 await assert.rejects(f.service.complete({...a,body:{attemptId:s.attemptId}}),{code:'REGISTRO_ALTERADO'});assert.equal((await f.store.get('ficha',f.ficha.id)).assinaturaBiometrica.id,'existing-digital');assert.equal(f.images.size,1);
});
test('selo adulterado, chave do navegador e conteúdo trocado são recusados pelo certificador',async()=>{
 const f=await fixture();await f.enroll();const a=await f.args(),s=await f.service.begin(a),{item}=await f.service.complete({...a,body:{attemptId:s.attemptId}});
 assert.throws(()=>verifyFacialProof(item,{}),{code:'FACIAL_PROVA_INVALIDA'});
 for(const change of [{itens:[]},{modeloFicha:{...item.modeloFicha,termoAssinatura:'trocado'}},{assinaturaBiometrica:{...item.assinaturaBiometrica,proofSignature:'AAAA'}},{assinaturaBiometrica:{...item.assinaturaBiometrica,keyArn:'browser-key'}}])assert.throws(()=>verifyFacialProof({...item,...change},f.keys),{code:'FACIAL_PROVA_INVALIDA'});
});
test('falha de leitura após commit não apaga a evidência aprovada',async()=>{
 const f=await fixture();await f.enroll();const a=await f.args(),s=await f.service.begin(a),get=f.store.get;let committed=false;const transaction=f.store.transact;
 f.store.transact=async p=>{const r=await transaction(p);if(p.mutationId===`facial:${s.attemptId}`)committed=true;return r;};
 f.store.get=async(entity,id)=>{if(committed&&entity==='ficha')throw Error('synthetic connection failure');return get(entity,id);};
 await assert.rejects(f.service.complete({...a,body:{attemptId:s.attemptId}}));assert.equal(f.images.size,2);assert.equal((await get('ficha',f.ficha.id)).status,'assinada');
});
