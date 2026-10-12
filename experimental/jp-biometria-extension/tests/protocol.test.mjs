import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {allowedMessage,allowedWebsite,sanitizeResponse} from '../extension/protocol.js';
import {STATES,stateFor} from '../extension/states.js';
import {EXTENSION_ID} from '../extension/config.js';
import {createHash} from 'node:crypto';

test('manifest has only nativeMessaging; no certificates, content scripts or broad host permissions',()=>{
  const m=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url)));
  assert.deepEqual(m.permissions,['nativeMessaging']); assert.equal(m.host_permissions,undefined); assert.equal(m.content_scripts,undefined);
  const id=[...createHash('sha256').update(Buffer.from(m.key,'base64')).digest('hex').slice(0,32)].map(n=>String.fromCharCode(97+parseInt(n,16))).join('');
  assert.equal(id,EXTENSION_ID);assert.match(readFileSync(new URL('../connector/config.go',import.meta.url),'utf8'),new RegExp(EXTENSION_ID));
});
test('only fixed commands and valid fingers can leave the popup',()=>{
  assert.equal(allowedMessage({action:'status'}),true);
  assert.equal(allowedMessage({action:'captureTest',finger:'R_INDEX'},true),true);
  for(const r of [null,[],{action:'certificate'},{action:'shutdown'},{action:'enroll'},{action:'captureTest',finger:'BAD'},{action:'status',url:'https://example.com'}]) assert.equal(allowedMessage(r,true),false);
  assert.equal(allowedMessage({action:'captureTest',finger:'R_INDEX'},false),false);
});
test('external status restricted to top-level EntregaEPI on exact JP origin',()=>{
  const sender={url:'https://www.jptreinamentos.com.br/EntregaEPI/',origin:'https://www.jptreinamentos.com.br',frameId:0};
  assert.equal(allowedWebsite(sender),true);
  for(const url of ['https://www.jptreinamentos.com.br.evil.test/EntregaEPI/','http://www.jptreinamentos.com.br/EntregaEPI/','https://www.jptreinamentos.com.br/adm/','https://www.jptreinamentos.com.br/EntregaEPI-fake/','javascript:alert(1)']) assert.equal(allowedWebsite({...sender,url}),false);
  assert.equal(allowedWebsite({...sender,frameId:1}),false); assert.equal(allowedWebsite({...sender,origin:'null'}),false);
});
test('raw agent keys, templates and certificate details never reach popup or website',()=>{
  assert.deepEqual(sanitizeResponse({code:'READY',ok:true,template:'SECRET',biometricPublicKey:'SECRET',certificates:['SECRET'],message:'SECRET',port:9000}),{ok:true,code:'READY'});
  assert.deepEqual(sanitizeResponse({code:'UNKNOWN',ok:true}),{ok:false,code:'CONNECTOR_ERROR'});
});
test('image responses are accepted only for a capture request and a bounded PNG data URL',()=>{
  const r={code:'CAPTURE_OK',image:'data:image/png;base64,AAAA',width:64,height:80};
  assert.equal(sanitizeResponse(r,true).code,'CAPTURE_OK'); // Complete PNG is validated by native host.
  assert.equal(sanitizeResponse(r,false).code,'IMAGE_MISSING');
  assert.equal(sanitizeResponse({...r,image:'https://remote/image.png'},true).code,'IMAGE_MISSING');
  assert.equal(sanitizeResponse({...r,width:50000},true).code,'IMAGE_MISSING');
});
test('all status codes provide a concrete next action in Portuguese',()=>{
  for(const [code,value] of Object.entries(STATES)){assert.equal(value.length,4,code);for(const text of value)assert.ok(text.length>0)}
  assert.deepEqual(stateFor('unexpected'),STATES.CONNECTOR_ERROR);
});
