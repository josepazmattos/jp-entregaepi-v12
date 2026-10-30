import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const {chromium}=await import(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'));
await mkdir('out',{recursive:true});
await build({entryPoints:['web/app.jsx'],bundle:true,outfile:'out/browser-test.js',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-camera-double',setup(build){build.onResolve({filter:/^@aws-amplify\/ui-react-liveness$/},()=>({path:path.resolve('test/sdk-double.jsx')}));}}]});
let mock=false;
const server=createServer(async(req,res)=>{
  try{
    const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0];
    if(name==='EntregaEPI/assets/logo-jp.png'){res.setHeader('content-type','image/png');return res.end(await readFile('../../frontend/EntregaEPI/assets/logo-jp.png'));}
    const location=name==='app.js'&&mock?'out/browser-test.js':'dist/web/'+name;
    if(name==='config.js'){res.setHeader('content-type','application/javascript');return res.end('window.JP_FACIAL_CONFIG={apiUrl:"https://pilot-test.execute-api.sa-east-1.amazonaws.com"};');}
    res.setHeader('content-type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'text/html');
    res.end(await readFile(location));
  }catch{res.statusCode=404;res.end('not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell',headless:true,args:['--no-sandbox','--single-process','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
const page=await context.newPage(),errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
let records=[],current,completed=0,cancelled=0,delayNext=false;
await context.route('https://pilot-test.execute-api.sa-east-1.amazonaws.com/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postData()?JSON.parse(req.postData()):{};let result;
  if(url.pathname==='/records')result={items:records,captureEnabled:true,pilotEnd:'2026-11-06T23:59:59Z'};
  else if(url.pathname==='/sessions'){
    const selected=records.find(r=>r.id===body.enrollmentId);
    current={attemptId:randomUUID(),sessionId:randomUUID(),contentHash:'a'.repeat(64),snapshot:{...body,name:body.name||selected.name,company:body.company||selected.company},credentials:{accessKeyId:'SYNTHETIC_ONLY',secretAccessKey:'not-real',sessionToken:'not-real',expiration:'2030-01-01T00:00:00Z'},region:'sa-east-1'};result=current;
    if(delayNext){delayNext=false;await new Promise(r=>setTimeout(r,300));}
  }else if(url.pathname==='/sessions/complete'){
    completed++;const record={id:randomUUID(),type:current.snapshot.kind==='ENROLL'?'ENROLL':'RECEIPT',state:current.snapshot.kind==='ENROLL'?'ACTIVE':'CONFIRMED_TEST',name:current.snapshot.name,company:current.snapshot.company,createdAt:new Date().toISOString(),testOnly:true};records.unshift(record);result={approved:true,record};
  }else if(url.pathname==='/sessions/cancel'){cancelled++;result={cancelled:true};}
  else if(url.pathname.endsWith('/pdf'))return route.fulfill({status:200,contentType:'application/pdf',body:await readFile('out/ficha.pdf')});
  else throw Error('Unexpected pilot route '+url.pathname);
  await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':base},body:JSON.stringify({ok:true,...result})});
});
async function pass(name){checks.push({name,passed:true});console.log('PASS:',name);}
async function enrollForm(){await page.getByRole('button',{name:'1. CADASTRAR ROSTO'}).click();await page.getByLabel('Nome ou identificação do participante').fill('PARTICIPANTE FICTÍCIO');await page.getByLabel(/Como responsável/).check();await page.getByLabel(/Eu, participante adulto/).check();}
async function waitStatus(text){await page.getByRole('status').filter({hasText:text}).waitFor();}
try{
  await page.goto(base);await page.getByRole('heading',{name:'Acesso Master'}).waitFor();assert.equal(errors.length,0);await pass('Bundle real inicia sem erro e exige login; nenhuma câmera automática');
  for(const [width,height]of [[320,740],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}await pass('Tela de acesso cabe em seis tamanhos');
  mock=true;await page.evaluate(()=>sessionStorage.setItem('jp-facial-pilot-auth',JSON.stringify({idToken:'synthetic-test-token',username:'master.teste',expiresAt:Date.now()+3600000})));await page.reload();await page.getByRole('heading',{name:'Cadastro facial de teste'}).waitFor();
  for(const [width,height]of [[320,740],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}await page.setViewportSize({width:390,height:844});await pass('Tela autenticada cabe em celular, tablet e desktop');
  assert(await page.getByRole('button',{name:'INICIAR CADASTRO FACIAL',exact:true}).isDisabled());await pass('Cadastro exige ciência voluntária e conferência de identidade');
  await enrollForm();await page.getByRole('button',{name:'INICIAR CADASTRO FACIAL',exact:true}).click();await page.getByRole('button',{name:'ABRIR CÂMERA SIMULADA'}).click();await page.waitForFunction(()=>window.syntheticTracks?.[0]?.readyState==='live');
  await page.getByRole('button',{name:'DIGITAL NITGEN',exact:true}).click();await page.getByRole('heading',{name:'Leitura digital preservada'}).waitFor();assert(await page.evaluate(()=>window.syntheticTracks.every(t=>t.readyState==='ended')));assert.equal(completed,0);assert.equal(await page.getByRole('button',{name:'FACIAL PELA CÂMERA',exact:true}).getAttribute('aria-pressed'),'false');await pass('Digital e facial são exclusivos e a troca encerra a câmera');
  await page.getByRole('button',{name:'FACIAL PELA CÂMERA',exact:true}).click();await enrollForm();await page.getByRole('button',{name:'INICIAR CADASTRO FACIAL',exact:true}).click();await page.getByRole('button',{name:'ABRIR CÂMERA SIMULADA'}).click();await page.getByRole('button',{name:'CONCLUIR CÂMERA SIMULADA'}).click();await waitStatus('Cadastro facial de teste concluído');assert.equal(records[0].type,'ENROLL');await pass('Cadastro concluído habilita entrega sem pedir digital');
  await page.getByLabel(/Confirmo, exclusivamente neste teste/).check();await page.getByLabel(/Eu, participante adulto/).check();await page.getByRole('button',{name:'CONFIRMAR FICHA POR ROSTO'}).click();assert(await page.getByLabel('Equipamento',{exact:true}).isDisabled());await page.getByRole('button',{name:'ABRIR CÂMERA SIMULADA'}).click();await page.getByRole('button',{name:'CONCLUIR CÂMERA SIMULADA'}).click();await waitStatus('Verificação facial aprovada no teste');assert.equal(records[0].type,'RECEIPT');assert.equal(completed,2);await pass('Itens ficam congelados durante captura; resultado do servidor libera ficha');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'BAIXAR PDF',exact:true}).first().click();const file=await download;await file.saveAs('out/browser-download.pdf');assert((await readFile('out/browser-download.pdf')).subarray(0,4).toString()==='%PDF');await pass('PDF de teste é baixado com autenticação');
  await enrollForm();await page.getByRole('button',{name:'INICIAR CADASTRO FACIAL',exact:true}).click();await page.getByRole('button',{name:'ABRIR CÂMERA SIMULADA'}).click();await page.waitForFunction(()=>window.syntheticTracks?.[0]?.readyState==='live');await context.setOffline(true);await page.waitForFunction(()=>window.syntheticTracks.every(t=>t.readyState==='ended'));assert.equal(completed,2);await context.setOffline(false);await pass('Perda de conexão interrompe captura sem criar confirmação');
  await page.evaluate(()=>navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');});await enrollForm();await page.getByRole('button',{name:'INICIAR CADASTRO FACIAL',exact:true}).click();await page.getByRole('button',{name:'ABRIR CÂMERA SIMULADA'}).click();await waitStatus('Permita o uso da câmera');assert.equal(completed,2);await pass('Permissão negada apresenta orientação e mantém tentativa sem aprovação');
  await enrollForm();delayNext=true;await page.getByRole('button',{name:'INICIAR CADASTRO FACIAL',exact:true}).click();await page.getByRole('button',{name:'DIGITAL NITGEN',exact:true}).click();await page.waitForTimeout(600);assert.equal(await page.getByRole('button',{name:'ABRIR CÂMERA SIMULADA'}).count(),0);assert.equal(completed,2);await pass('Resposta tardia de criação não reabre câmera após mudar o método');
  assert(!requests.some(u=>u.includes(':8789')||u.includes('rekognition.amazonaws.com')));assert.equal(errors.length,0);await pass('Teste automatizado não acessa NITGEN nem envia biometria real à AWS');
  await page.getByRole('button',{name:'FACIAL PELA CÂMERA',exact:true}).click();await page.screenshot({path:'out/mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'out/desktop.png',fullPage:true});
  await writeFile('out/browser-results.json',JSON.stringify({passed:true,checks,browser:await browser.version(),camera:'synthetic',provider:'test double',physicalDevices:false,realFaceAccuracyTested:false,cancelled},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
