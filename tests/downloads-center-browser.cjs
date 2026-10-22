// Real Chromium UI, synthetic authentication/API, no real customer data or USB capture.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(process.env.JP_DOWNLOADS_TEST_ROOT||path.join(__dirname,'../frontend/EntregaEPI'));
const output=path.resolve(process.env.JP_DOWNLOADS_TEST_OUTPUT||path.join(__dirname,'output/downloads'));
fs.mkdirSync(output,{recursive:true});
const checks=[];
const server=http.createServer((req,res)=>{
  let route=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/EntregaEPI\/?/,'')||'index.html';
  if(route.startsWith('updates/downloads-20261022-1/')&&!fs.existsSync(path.join(root,route)))route='assets/'+path.basename(route);
  if(route.endsWith('.exe')){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+path.basename(route)+'"'});res.end('SYNTHETIC DOWNLOAD: file bytes verified separately');return;}
  const file=path.resolve(root,route);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
  let data=fs.readFileSync(file);
  if(path.extname(file)==='.html')data=Buffer.from(data.toString().replaceAll('__APP_PREFIX__','EntregaEPI'));
  res.end(data);
});
let browser,origin;
function pass(name){checks.push(name);console.log('PASS '+name);}
async function createContext(role,width=1440){
  const ctx=await browser.newContext({viewport:{width,height:1100},locale:'pt-BR',acceptDownloads:true});
  const errors=[],external=[],mutations=[];
  if(role)await ctx.addInitScript(role=>{
    sessionStorage.setItem('jp-v12-auth',JSON.stringify({username:'TESTE-'+role,idToken:'SYNTHETIC',expiresAt:Date.now()+3600000,payload:{'cognito:groups':[role],'custom:empresaId':'EMPRESA-TESTE',sub:'synthetic'}}));
    sessionStorage.setItem('jp-v12-active-company','EMPRESA-TESTE');
    Object.defineProperty(navigator.permissions,'query',{value:async()=>({state:'granted'})});
  },role);
  await ctx.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===origin){
      if(url.pathname.endsWith('.exe'))return route.fulfill({status:200,contentType:'application/octet-stream',headers:{'Content-Disposition':'attachment; filename="'+path.basename(url.pathname)+'"'},body:'SYNTHETIC DOWNLOAD: file bytes verified separately'});
      return route.continue();
    }
    external.push(url.href);
    if(req.method()!=='GET')mutations.push(req.method()+' '+url.href);
    const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.hostname==='127.0.0.1')return route.abort();
    if(url.hostname.endsWith('.execute-api.sa-east-1.amazonaws.com')){
      if(url.pathname==='/health')return json({ok:true,durable:true,storageReady:true});
      if(url.pathname==='/api/empresas')return json({ok:true,items:[{id:'EMPRESA-TESTE',nome:'EMPRESA DEMONSTRAÇÃO',cnpj:'00000000000000'}]});
      if(url.pathname==='/api/caepi/365')return json({ok:true,item:{found:true,officialSnapshot:true,downloadedAt:'2026-10-22',autofillAllowed:true}});
      if(url.pathname.includes('certificado'))return json({ok:true,certificate:null});
      return json({ok:true,items:[]});
    }
    return route.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,errors,external,mutations};
}
async function assertCenter(page){
  await page.locator('#jpDownloadProblem').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-jp-download]').count(),2);
  assert.ok((await page.locator('#downloadReparadorLink').getAttribute('href')).endsWith('/JP-Biometria-Reparador-12.10.1.exe'));
  assert.ok((await page.locator('#downloadBiometriaLink').getAttribute('href')).endsWith('/JP-Biometria-Instalador-Unico.exe'));
  for(const key of ['installation','install_failed','missing_file','network','permission','sdk','nitgen','reader','blocked']){
    await page.selectOption('#jpDownloadProblem',key);
    assert.equal(await page.locator('#jpDownloadGuidance li').count(),3);
    assert.ok((await page.locator('#jpDownloadGuidance').innerText()).length>100);
  }
  await page.selectOption('#jpDownloadProblem','missing_file');
  assert.match(await page.locator('#jpDownloadGuidance').innerText(),/REPARADOR DO COMPONENTE/);
  assert.equal(await page.locator('a[href^="https://suporte.fingertech.com.br/"]').count(),1);
  assert.equal(await page.locator('.jp-downloads [data-master-only]').count(),0);
}
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{}),headless:true,args:['--no-sandbox']});
  for(const role of ['MASTER','EMPRESA']){
    const s=await createContext(role);await s.page.goto(origin+'/EntregaEPI/');
    await s.page.locator('#appShell').waitFor({state:'visible'});
    await s.page.locator('.nav [data-screen="config"]').click();
    await assertCenter(s.page);pass(role+' reaches Configurações / Downloads and all nine guides');
    const downloads=[];
    for(const id of ['downloadBiometriaLink','downloadReparadorLink']){
      const pending=s.page.waitForEvent('download');await s.page.locator('#'+id).click();
      const download=await pending;downloads.push(download.suggestedFilename());
    }
    assert.deepEqual(downloads,['JP-Biometria-Instalador-Unico.exe','JP-Biometria-Reparador-12.10.1.exe']);
    assert.ok(await s.page.evaluate(()=>Number(sessionStorage.getItem('jp-biometria-install-until'))>Date.now()));
    pass(role+' downloads both files and activates existing installation monitor');
    await s.page.locator('#jpDownloadsTest').click();assert.ok(await s.page.locator('#screen-biometria').evaluate(n=>n.classList.contains('active')));
    await s.page.locator('#bioDownloadsCenter').click();assert.ok(await s.page.locator('#screen-config').evaluate(n=>n.classList.contains('active')));
    assert.equal(await s.page.locator('#jpDownloadProblem').evaluate(n=>n===document.activeElement),true);
    assert.ok(await s.page.evaluate(()=>document.getElementById('downloadsTitle').getBoundingClientRect().top>=document.querySelector('.app-header').getBoundingClientRect().bottom),'download heading stays below the sticky header');
    pass(role+' can return from Biometria directly to the repair center');
    await s.page.selectOption('#jpDownloadProblem','install_failed');
    await s.page.locator('#downloadsBiometria').screenshot({path:path.join(output,role.toLowerCase()+'.png')});
    assert.deepEqual(s.errors,[]);assert.deepEqual(s.mutations,[]);await s.ctx.close();
  }
  for(const width of [1440,390]){
    const s=await createContext(null,width);await s.page.goto(origin+'/EntregaEPI/downloads.html');await assertCenter(s.page);
    assert.equal(s.external.length,0,'public page must not access account APIs or local biometric service');
    assert.equal(await s.page.locator('h1').count(),1);
    assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow');
    await s.page.selectOption('#jpDownloadProblem','network');
    await s.page.screenshot({path:path.join(output,'public-'+width+'.png'),fullPage:true});
    assert.deepEqual(s.errors,[]);await s.ctx.close();pass('Public page without login at '+width+'px; no account/local-service requests');
  }
  const mobile=await createContext('EMPRESA',390);await mobile.page.goto(origin+'/EntregaEPI/');
  await mobile.page.locator('#appShell').waitFor({state:'visible'});
  await mobile.page.evaluate(()=>goScreen('config'));await assertCenter(mobile.page);
  assert.ok(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile app has no horizontal overflow');
  await mobile.page.locator('#downloadsBiometria').screenshot({path:path.join(output,'empresa-mobile.png')});
  assert.deepEqual(mobile.errors,[]);await mobile.ctx.close();pass('Empresa mobile layout and error guides');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks,syntheticServices:true,physicalReaderTested:false},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
