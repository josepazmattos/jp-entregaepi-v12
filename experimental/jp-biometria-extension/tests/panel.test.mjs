import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {stateFor} from '../extension/states.js';
import {sanitizeResponse,allowedMessage,allowedWebsite} from '../extension/protocol.js';

const html=readFileSync(new URL('../extension/popup.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8').replace(/^import .*$/gm,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function createPanel(send){
  const {window,document}=parseHTML(html);const timers=[];
  const context=vm.createContext({window,document,stateFor,sanitizeResponse,chrome:{runtime:{sendMessage:send}},setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(){}});
  vm.runInContext(source,context);
  return {window,document,timers,$:id=>document.getElementById(id)};
}
test('panel starts without a hardware request; capture requires ready state',async()=>{
  let calls=0;const p=createPanel(async()=>{calls++;return{code:'SDK_NOT_FOUND'}});
  assert.equal(calls,0);assert.equal(p.$('capture').disabled,true);
  p.$('verify').click();await flush();assert.equal(calls,1);assert.equal(p.$('capture').disabled,true);
  assert.equal(p.$('status-title').textContent,'Integração NITGEN ausente');assert.match(p.$('next-step').textContent,/suporte JP/);
});
test('capture image is temporary and never triggers enrollment or certification',async()=>{
  const sent=[];const p=createPanel(async r=>{sent.push(r);return r.action==='status'?{code:'READY'}:{code:'CAPTURE_OK',image:'data:image/png;base64,AAAA',width:64,height:80}});
  p.$('verify').click();await flush();assert.equal(p.$('capture').disabled,false);
  p.$('capture').click();await flush();assert.equal(p.$('image-box').hidden,false);
  assert.equal(sent[1].action,'captureTest');assert.equal(sent.length,2);
  p.$('clear').click();assert.equal(p.$('finger-image').getAttribute('src'),null);assert.equal(p.$('image-box').hidden,true);
  p.$('capture').click();await flush();p.timers.at(-1)();assert.equal(p.$('finger-image').getAttribute('src'),null);
});
test('double-click does not create a second capture and rejected response removes stale image',async()=>{
  let resolve,calls=0;const p=createPanel(()=>{calls++;return new Promise(r=>resolve=r)});
  p.$('verify').click();p.$('verify').click();assert.equal(calls,1);
  resolve({code:'READY'});await flush();assert.equal(p.$('verify').disabled,false);
  p.$('capture').click();resolve({code:'CAPTURE_OK',image:'https://foreign/image',width:64,height:80});await flush();
  assert.equal(p.$('image-box').hidden,true);assert.equal(p.$('capture').disabled,true);assert.equal(p.$('status-title').textContent,'Imagem não confirmada');
});
test('closing the popup clears image data',async()=>{
  const p=createPanel(async r=>r.action==='status'?{code:'READY'}:{code:'CAPTURE_OK',image:'data:image/png;base64,AAAA',width:64,height:80});
  p.$('verify').click();await flush();p.$('capture').click();await flush();
  p.window.dispatchEvent(new p.window.Event('pagehide'));assert.equal(p.$('finger-image').getAttribute('src'),null);
});

test('native worker handles missing host and rejects certificates before opening native connection',async()=>{
  const listeners={};let connects=0;
  const chrome={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,
    onMessage:{addListener:fn=>listeners.internal=fn},onMessageExternal:{addListener:fn=>listeners.external=fn},
    connectNative(){connects++;throw new Error('Specified native messaging host not found.')},
  }};
  const script=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*$/gm,'');
  vm.runInNewContext(script,{chrome,allowedMessage,allowedWebsite,sanitizeResponse,NATIVE_HOST:'test.host',setTimeout,clearTimeout,Date,Promise,Error});
  const sender={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
  const call=message=>new Promise(resolve=>listeners.internal(message,sender,resolve));
  assert.equal((await call({action:'certificate'})).code,'INVALID_REQUEST');assert.equal(connects,0);
  assert.equal((await call({action:'status'})).code,'CONNECTOR_MISSING');assert.equal(connects,1);
  const denied=await new Promise(resolve=>listeners.external({action:'captureTest',finger:'R_INDEX'},{url:'https://www.jptreinamentos.com.br/EntregaEPI/',frameId:0},resolve));
  assert.equal(denied.code,'INVALID_REQUEST');assert.equal(connects,1);
});

test('offline preview contains no external scripts and all scenarios have real next-step text',()=>{
  const preview=readFileSync(new URL('../docs/modelo.html',import.meta.url),'utf8');const {document}=parseHTML(preview);
  assert.equal(document.querySelectorAll('script[src]').length,0);
  assert.equal(document.querySelectorAll('#verify').length,1);
  for(const option of document.querySelectorAll('#scenario option'))assert.ok(stateFor(option.value)[3].length>15);
  const scripts=[...document.querySelectorAll('script')];for(const script of scripts)new vm.Script(script.textContent);
});
