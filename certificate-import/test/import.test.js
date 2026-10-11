import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,privateDecrypt,createPrivateKey,createDecipheriv,verify,constants} from 'node:crypto';
import forge from 'node-forge';
import {openA1} from '../core.js';
import {detachedCms} from '../../backend/src/services/jpged-cms.js';
const dir=mkdtempSync(join(tmpdir(),'jp-a1-browser-'));after(()=>rmSync(dir,{recursive:true,force:true}));
execFileSync('python3',[new URL('../../backend/test/helpers/jpged-fixture.py',import.meta.url).pathname,dir]);
const read=name=>Uint8Array.from(readFileSync(join(dir,name))).buffer;
const wrapping=generateKeyPairSync('rsa',{modulusLength:4096});
function configuration(chain,company='company'){
 const packet={schema:'JPGED-COFRE-1',id:'import',companyId:company,expires:Math.floor(Date.now()/1000)+300,scope:'Autorizar exclusivamente a certificação das fichas de EPI desta empresa confirmadas biometricamente'};
 const content=Buffer.from(JSON.stringify(packet)),built=detachedCms(content,chain);
 return {id:'import',contentBase64:content.toString('base64'),signingBase64:built.signedBytes.toString('base64')};
}
for(const [file,key] of [['synthetic.pfx','leaf.key'],['pf.pfx','pf.key'],['chain.pfx','chain.key']])test('abre '+file+', comprova posse e protege chave compatível com OpenSSL RFC5649',async()=>{
 const data=read(file),session=await openA1(data,'synthetic-test-only','company');assert.ok(new Uint8Array(data).every(x=>x===0));
 const c=configuration(session.info.chain),proof=await session.prove(c),publicKey=createPrivateKey(readFileSync(join(dir,key)));
 assert.ok(verify('sha256',Buffer.from(c.signingBase64,'base64'),publicKey,Buffer.from(proof.signature,'base64')));
 const result=await session.wrap(wrapping.publicKey.export({format:'der',type:'spki'}).toString('base64')),blob=Buffer.from(result.wrappedKey,'base64');
 const aes=privateDecrypt({key:wrapping.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},blob.subarray(0,512));
 const decipher=createDecipheriv('id-aes256-wrap-pad',aes,Buffer.from('a65959a6','hex'));const unwrapped=Buffer.concat([decipher.update(blob.subarray(512)),decipher.final()]);
 assert.deepEqual(unwrapped,publicKey.export({format:'der',type:'pkcs8'}));
 await assert.rejects(session.wrap(''),/Reinicie/);await assert.rejects(session.prove(c),/já foi usada/);session.dispose();
});
test('PFX legado 3DES e senha vazia são lidos localmente',async()=>{
 const privateKey=forge.pki.privateKeyFromPem(readFileSync(join(dir,'leaf.key'),'utf8')),cert=forge.pki.certificateFromPem(readFileSync(join(dir,'leaf.pem'),'utf8'));
 for(const password of ['senha-legada','']){const pfx=forge.pkcs12.toPkcs12Asn1(privateKey,[cert],password,{algorithm:'3des'}),data=Uint8Array.from(forge.asn1.toDer(pfx).getBytes(),c=>c.charCodeAt(0));const session=await openA1(data.buffer,password,'company');assert.equal(session.info.chain.length,1);session.dispose();}
});
test('senha incorreta, arquivo quebrado, tipo/tamanho inválido são recusados',async()=>{
 await assert.rejects(openA1(read('synthetic.pfx'),'errada','company'),/senha/);
 await assert.rejects(openA1(new Uint8Array([1,2,3]).buffer,'','company'),/Não foi possível/);
 await assert.rejects(openA1(new ArrayBuffer(1024*1024+1),'','company'),/até 1 MB/);
 await assert.rejects(openA1(read('synthetic.pfx'),'synthetic-test-only',''),/Selecione/);
});
test('certificado sem chave privada é recusado',async()=>{
 const cert=forge.pki.certificateFromPem(readFileSync(join(dir,'leaf.pem'),'utf8')),pfx=forge.pkcs12.toPkcs12Asn1(null,[cert],'test');
 const data=Uint8Array.from(forge.asn1.toDer(pfx).getBytes(),c=>c.charCodeAt(0)).buffer;await assert.rejects(openA1(data,'test','company'),/chave privada/);
});
test('empresa divergente e conteúdo adulterado não geram prova',async()=>{
 const session=await openA1(read('synthetic.pfx'),'synthetic-test-only','company');
 await assert.rejects(session.prove(configuration(session.info.chain,'other')),/empresa/);
 const c=configuration(session.info.chain);c.contentBase64=Buffer.from(Buffer.from(c.contentBase64,'base64').toString().replace('"id":"import"','"id":"alterado"')).toString('base64');await assert.rejects(session.prove(c),/autorização/);session.dispose();
});
