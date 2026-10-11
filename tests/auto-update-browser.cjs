const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const old='1'.repeat(40),next='2'.repeat(40);let published=old,unavailable=false,reloads=0;
const script=fs.readFileSync(path.resolve(__dirname,'../frontend/EntregaEPI/assets/auto-update.js'));
const html=version=>`<!doctype html><html><head><meta name="jp-build" content="${version}"></head><body><main id="loginPage" hidden></main><main id="appShell"><section id="screen-dashboard" class="active"><button id="idle">Dashboard</button></section><section><form id="draft"><input id="worker"></form></section><button id="logoutButton">Sair</button></main><script>window.JP_CONFIG={appBasePath:'/EntregaEPI/'};let biometricBusy=false,entregaItems=[],operationWindows=new Set();</script><script src="/auto-update.js"></script></body></html>`;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/auto-update.js'){res.setHeader('Content-Type','text/javascript');return res.end(script);}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html');if(u.searchParams.has('update-check')){res.statusCode=unavailable?503:200;return res.end(html(published));}if(u.searchParams.has('v'))reloads++;res.end(html(u.searchParams.has('v')?published:old));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{}),headless:true,args:['--no-sandbox']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const url=`http://127.0.0.1:${server.address().port}/EntregaEPI/`;
 try{
  await page.goto(url);await page.evaluate(()=>{sessionStorage.setItem('session','preserved');localStorage.setItem('preference','preserved');});
  await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,0);
  unavailable=true;published=next;await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,0);unavailable=false;
  await page.evaluate(()=>biometricBusy=true);await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,0);
  await page.evaluate(()=>{biometricBusy=false;operationWindows.add({closed:false});});await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,0);
  await page.evaluate(()=>{operationWindows.clear();entregaItems.push({quantidade:1});});await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,0);
  await page.evaluate(()=>{entregaItems=[];const d=document.createElement('dialog');d.innerHTML='<button>Fechar</button>';document.body.append(d);d.showModal();});await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,0);await page.evaluate(()=>document.querySelector('dialog').remove());
  await page.fill('#worker','Nome ainda não salvo');await page.click('#idle');await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,0);assert.equal(await page.inputValue('#worker'),'Nome ainda não salvo');
  await page.evaluate(()=>document.getElementById('draft').reset());
  await Promise.all([page.waitForURL('**?v='+next),page.evaluate(()=>JPAutoUpdate.check())]);await page.waitForLoadState();assert.equal(reloads,1);assert.equal(await page.evaluate(()=>sessionStorage.getItem('session')),'preserved');assert.equal(await page.evaluate(()=>localStorage.getItem('preference')),'preserved');
  await page.evaluate(()=>JPAutoUpdate.check());assert.equal(reloads,1);assert.deepEqual(errors,[]);
  console.log('PASSOU: atualização automática; versão igual/offline sem recarga; captura, ficha aberta, itens, diálogo e preenchimento bloqueiam; recarga única preserva sessão e preferências.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
