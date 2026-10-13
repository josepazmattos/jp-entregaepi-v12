// Real browser, synthetic accounts/data. Every external request is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const frontend=path.resolve(__dirname,'../frontend/EntregaEPI'),out=path.join(__dirname,'output/visual-navigation');fs.mkdirSync(out,{recursive:true});
const company={id:'VISUAL-EMPRESA',nome:'EMPRESA EXEMPLO',cnpj:'00.000.000/0000-00',localidade:'Cidade exemplo',uf:'MS'};
const worker={id:'VISUAL-PESSOA',empresaId:company.id,nomeCompleto:'COLABORADOR EXEMPLO',cpf:'000.000.000-00',funcao:'TÉCNICO DE CAMPO',status:'Ativo'};
const epi={id:'VISUAL-EPI',descricao:'CAPACETE DE SEGURANÇA',nomeCurto:'CAPACETE DE SEGURANÇA',ca:'00000',fabricante:'FABRICANTE EXEMPLO'};
const ficha={id:'VISUAL-FICHA',numero:'EPI-EXEMPLO-0001',empresaId:company.id,trabalhadorId:worker.id,trabalhadorNome:worker.nomeCompleto,tipo:'Entrega',data:'13/10/2026',status:'pendente',itens:[{epiId:epi.id,epiDescricao:epi.descricao,ca:epi.ca,quantidade:1}]};
const database={empresas:[company],trabalhadores:[worker],epis:[epi],fichas:[ficha]};
const errors=[],writes=[],checks=[];let browser;
const server=http.createServer((req,res)=>{
 const file=path.resolve(frontend,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/EntregaEPI\/?/,'')||'index.html');
 if(!file.startsWith(frontend+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[ext]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
 const b=fs.readFileSync(file);res.end(ext==='.html'?b.toString().replaceAll('__APP_PREFIX__','EntregaEPI'):b);
});
const pass=name=>{checks.push(name);console.log('PASSOU: '+name);};
async function layout(page,name,screenshot=false){
 await page.evaluate(()=>new Promise(requestAnimationFrame));
 const d=await page.evaluate(()=>({width:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,main:document.querySelector('#mainContent').getBoundingClientRect().width}));
 assert.ok(d.doc<=d.width+1&&d.body<=d.width+1,name+': no horizontal page overflow '+JSON.stringify(d));
 if(screenshot)await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});return d;
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{}),headless:true,args:['--no-sandbox']});
 for(const role of ['MASTER','EMPRESA']){
  const context=await browser.newContext({viewport:{width:1366,height:900},locale:'pt-BR'});
  const payload={sub:'VISUAL-'+role,'cognito:username':'USUÁRIO EXEMPLO','cognito:groups':[role],'custom:empresa_id':company.id,exp:4102444800};
  const token='header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.synthetic';
  await context.addInitScript(({payload,token,company})=>{sessionStorage.setItem('jp-v12-auth',JSON.stringify({username:'USUÁRIO EXEMPLO',idToken:token,payload,expiresAt:Date.now()+3600000}));sessionStorage.setItem('jp-v12-active-company',company);},{payload,token,company:company.id});
  await context.route(u=>u.origin!==origin,async route=>{
   const req=route.request(),u=new URL(req.url()),json=b=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
   if(req.method()!=='GET'){writes.push({method:req.method(),path:u.pathname});return route.abort();}
   if(u.hostname==='127.0.0.1')return json({ok:true,service:'JP Biometria',version:'12.10.0-bio2',sdk:true,reader:true,deviceCount:1,capabilities:{capture:true,verify:true,templates:true}});
   if(u.pathname==='/health')return json({ok:true,durable:true,storageReady:true,version:'12.10.0'});
   if(u.pathname.startsWith('/api/caepi/'))return json({ok:true,item:{found:true,ca:'365',name:'CAPACETE',officialSnapshot:true}});
   if(u.pathname==='/api/jpged/certificado')return json({ok:true,certificate:null});
   if(u.pathname.startsWith('/api/jpged'))return json({ok:true,items:[]});
   if(u.pathname==='/api/epis/catalogo')return json({ok:true,items:[epi],total:1,page:1,pageSize:15,pages:1});
   const key=u.pathname.replace('/api/','');if(database[key])return json({ok:true,items:database[key]});
   return json({ok:true,items:[]});
  });
  await context.addInitScript(()=>{window.visualFocusTrace=[];document.addEventListener('focusin',e=>window.visualFocusTrace.push({id:e.target.id,tag:e.target.tagName,at:Date.now()}));});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/EntregaEPI/');await page.waitForSelector('#appShell:not(.hidden)');await page.waitForFunction(()=>document.getElementById('metricTrabalhadores').textContent==='1');
  assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'true');
  const open=await layout(page,role+'-desktop-aberto',role==='MASTER');
  await page.locator('#menuToggle').click();await page.locator('#primarySidebar').waitFor({state:'hidden'});assert.equal(await page.locator('#primarySidebar').isVisible(),false);assert.equal(await page.locator('#mainContent').evaluate(n=>n.inert),false);
  const closed=await layout(page,role+'-desktop-amplo',role==='MASTER');assert.ok(closed.main-open.main>=250,'Workspace gains sidebar width');
  await page.reload();await page.waitForSelector('#appShell:not(.hidden)');assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'false');
  await page.evaluate(()=>goScreen('trabalhadores'));await page.locator('#primarySidebar').waitFor({state:'hidden'});assert.equal(await page.locator('#primarySidebar').isVisible(),false);
  await page.locator('#menuToggle').click();assert.equal(await page.locator('#primarySidebar').isVisible(),true);await page.locator('#menuToggle').click();
  pass(role+': hide/show menu, content gains width, preference survives reload and navigation');
  if(role==='MASTER'){
   await page.evaluate(()=>goScreen('empresas'));await page.locator('#empresaNome').fill('RASCUNHO VISUAL');await page.locator('#menuToggle').click();await page.locator('#menuToggle').click();assert.equal(await page.locator('#empresaNome').inputValue(),'RASCUNHO VISUAL');
   await page.evaluate(()=>document.getElementById('empresaForm').reset());pass('Hiding the sidebar preserves form input');
  }
  const screens=role==='MASTER'?['dashboard','empresas','empresas-cadastradas','trabalhadores','epis','entrega','fichas','jpged','biometria','certificado','config']:['dashboard','trabalhadores','epis','entrega','fichas','jpged','biometria','config'];
  for(const width of [1920,1366,1280,1024,768,390,320]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(requestAnimationFrame));
   for(const screen of screens){await page.evaluate(s=>goScreen(s),screen);await layout(page,role+'-'+width+'-'+screen,role==='MASTER'&&((width===1366&&screen==='config')||(width===390&&screen==='dashboard')));}
  }
  pass(role+': every available screen fits widths 320, 390, 768, 1024, 1280, 1366 and 1920');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>goScreen('dashboard'));await page.locator('#menuToggle').click();assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#mainContent').evaluate(n=>n.inert),true);
  await layout(page,role+'-mobile-menu',true);try{await page.waitForFunction(()=>document.activeElement.id==='sidebarClose',null,{timeout:1500});}catch(error){console.log('FOCUS_DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>({active:document.activeElement.outerHTML.slice(0,500),shell:document.getElementById('appShell').className,sidebarInert:document.getElementById('primarySidebar').inert,sidebarStyle:{visibility:getComputedStyle(document.getElementById('primarySidebar')).visibility,transform:getComputedStyle(document.getElementById('primarySidebar')).transform},close:document.getElementById('sidebarClose').outerHTML,closeBounds:document.getElementById('sidebarClose').getBoundingClientRect().toJSON(),closeStyle:{display:getComputedStyle(document.getElementById('sidebarClose')).display,visibility:getComputedStyle(document.getElementById('sidebarClose')).visibility},errors:window.visualFocusTrace}))));throw error;}if(role==='EMPRESA')for(const name of ['empresas','empresas-cadastradas','certificado'])assert.equal(await page.locator('.nav [data-screen="'+name+'"]').isVisible(),false);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.screen),'config');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'sidebarClose');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'menuToggle');await page.locator('#primarySidebar').waitFor({state:'hidden'});assert.equal(await page.locator('#primarySidebar').isVisible(),false);
  await page.locator('#menuToggle').click();await page.locator('.nav [data-screen="fichas"]').click();await page.locator('#primarySidebar').waitFor({state:'hidden'});assert.equal(await page.locator('#primarySidebar').isVisible(),false);assert.equal(await page.locator('#screen-fichas').isVisible(),true);
  if(role==='EMPRESA')for(const name of ['empresas','empresas-cadastradas','certificado'])assert.equal(await page.locator('.nav [data-screen="'+name+'"]').isVisible(),false);
  pass(role+': mobile keyboard loop, Escape, navigation close, role visibility');
  await page.setViewportSize({width:1366,height:900});await page.locator('#primarySidebar').waitFor({state:'hidden'});assert.equal(await page.locator('#primarySidebar').isVisible(),false);await page.evaluate(()=>goScreen('config'));
  assert.ok((await page.locator('#downloadBiometriaLink').getAttribute('href')).includes('12.10.0-unico1'));
  const sizes=await page.evaluate(()=>({body:parseFloat(getComputedStyle(document.body).fontSize),button:parseFloat(getComputedStyle(document.getElementById('downloadBiometriaLink')).fontSize)}));assert.ok(sizes.body>=16&&sizes.button>=14);
  await context.close();
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);pass('No API writes, no JavaScript errors, current unified installer preserved');
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,syntheticData:true,browser:await browser.version(),checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
