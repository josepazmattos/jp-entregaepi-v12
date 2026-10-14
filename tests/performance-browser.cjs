// Controlled latency benchmark; synthetic accounts and data, no production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../frontend/EntregaEPI'),out=path.join(__dirname,'output/performance');fs.mkdirSync(out,{recursive:true});
const companies=[{id:'A',nome:'ALFA',status:'Ativa'},{id:'B',nome:'BETA',status:'Ativa'}];
const errors=[],results=[];let browser;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),baseline=url.pathname.startsWith('/baseline/');
 const relative=url.pathname.replace(/^\/(?:baseline\/)?EntregaEPI\/?/,'')||'index.html';
 let file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 if(baseline&&['index.html','assets/app.js'].includes(relative))file=path.join(__dirname,'baseline',path.basename(relative));
 const data=fs.readFileSync(file),type=({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream';
 res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');
 setTimeout(()=>res.end(relative==='index.html'?data.toString().replaceAll('__APP_PREFIX__',baseline?'baseline/EntregaEPI':'EntregaEPI'):data),relative==='config.js'?600:relative.endsWith('.js')?60:0);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{})});
 for(const baseline of [true,false]){
  const context=await browser.newContext(),requests=[];let authenticated=false;
  const payload={sub:'PERF-MASTER','cognito:groups':['MASTER'],'custom:empresa_id':'A',exp:4102444800},token='header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.synthetic';
  await context.route(u=>u.origin!==origin,async route=>{
   const req=route.request(),u=new URL(req.url());assert.equal(req.method(),'GET','No production or synthetic mutations');
   const company=req.headers()['x-empresa-id'];requests.push({path:u.pathname,company});
   const response=u.pathname==='/api/empresas'?{items:companies}:u.pathname==='/api/trabalhadores'?{items:[{id:'W'+company,empresaId:company,nomeCompleto:'WORKER '+company,status:'Ativo'}]}:u.pathname==='/api/fichas'?{items:[]}:u.pathname==='/api/epis'?{items:[{id:'EPI',nomeCurto:'LUVA',descricao:'LUVA',ca:'123'}]}:u.pathname==='/api/jpged/certificado'?{certificate:null}:u.pathname==='/health'?{durable:true,storageReady:true}:u.pathname.startsWith('/api/caepi')?{item:{found:true,officialSnapshot:true,ca:'365'}}:{service:'JP Biometria',version:'12.10.0-bio2',sdk:true,reader:true,deviceCount:1,capabilities:{capture:true,verify:true,templates:true}};
   await new Promise(r=>setTimeout(r,180));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,...response})}).catch(()=>{});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const url=origin+(baseline?'/baseline':'')+'/EntregaEPI/';
  await page.goto(url,{waitUntil:'commit'});await page.locator('#username').waitFor({state:'visible'});const loginVisibleMs=await page.evaluate(()=>performance.now());await page.waitForLoadState('load');
  await page.evaluate(({payload,token})=>{sessionStorage.setItem('jp-v12-auth',JSON.stringify({username:'PERF-MASTER',idToken:token,payload,expiresAt:Date.now()+3600000}));sessionStorage.setItem('jp-v12-active-company','A');},{payload,token});
  await page.reload();await page.waitForFunction(()=>document.getElementById('metricTrabalhadores').textContent==='1');await page.waitForTimeout(250);
  const result={version:baseline?'before':'after',latencyPerApiMs:180,configLatencyMs:600,loginVisibleMs:Math.round(loginVisibleMs),operations:[]};
  for(const fn of ['refreshEpis','refreshTrabalhadores','refreshFichas']){
   requests.length=0;const ms=await page.evaluate(async name=>{const start=performance.now();await window[name]();return performance.now()-start;},fn);
   const calls=requests.filter(x=>x.path.startsWith('/api/'));
   result.operations.push({operation:fn,ms:Math.round(ms),requests:calls.length,paths:calls.map(x=>x.path)});
   if(!baseline){assert.equal(calls.length,1);assert.equal(await page.locator('#metricTrabalhadores').innerText(),'1');}
  }
  await page.waitForTimeout(200);requests.length=0;
  const switchMs=await page.evaluate(async()=>{const start=performance.now();await changeActiveCompany('B');return performance.now()-start;});
  const scoped=requests.filter(x=>x.path.startsWith('/api/'));
  result.operations.push({operation:'changeActiveCompany',ms:Math.round(switchMs),requests:scoped.length,paths:scoped.map(x=>x.path)});
  assert.equal(await page.locator('#empresaAtivaSelect').inputValue(),'B');assert.equal(await page.locator('#entregaEmpresa').inputValue(),'B');assert.equal(await page.locator('#entregaTrabalhador').inputValue(),'WB');
  if(!baseline){assert.equal(scoped.length,3);assert.ok(scoped.every(x=>x.company==='B'));assert.ok(!scoped.some(x=>['/api/empresas','/api/epis'].includes(x.path)));}
  results.push(result);await context.close();
 }
 assert.deepEqual(errors,[]);assert.ok(results[1].loginVisibleMs<results[0].loginVisibleMs-250,'Login must render without waiting for delayed config');
 for(let i=0;i<4;i++)assert.ok(results[1].operations[i].ms<results[0].operations[i].ms-80,'Controlled latency improves: '+results[1].operations[i].operation);
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:true,synthetic:true,results},null,2));console.log('PERFORMANCE_RESULT '+JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
