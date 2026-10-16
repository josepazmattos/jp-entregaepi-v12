// Actual packaged application, HTTP browser cache and gzip; no production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {companyPdf}=require('./helpers/cadastro-fixtures.cjs');
const root=path.resolve(__dirname,'..'),source=path.join(root,'frontend/EntregaEPI');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'jp-cache-')),output=path.join(__dirname,'output/cache');fs.mkdirSync(output,{recursive:true});
const versions=['a'.repeat(40),'b'.repeat(40)],entries=new Map(),requests=[],errors=[],checks=[];
let published=versions[0],browser;
for(const version of versions){
 const folder=path.join(stage,version);
 execFileSync('python3',[path.join(root,'infra/frontend_release.py'),'--source',source,'--output',folder,'--commit',version]);
 entries.set(version,{folder,manifest:JSON.parse(fs.readFileSync(path.join(folder,'release-manifest.json')))});
}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');requests.push({path:u.pathname,encoding:req.headers['accept-encoding']});
 if(u.pathname==='/EntregaEPI/config.js'){
  res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});
  return res.end('window.JP_CONFIG='+JSON.stringify({appBasePath:'/EntregaEPI/',apiBaseUrl:'http://127.0.0.1:'+server.address().port+'/synthetic',version:'12.10.0',buildSha:published})+';');
 }
 let file,cache;
 if(['/EntregaEPI','/EntregaEPI/','/EntregaEPI/index.html'].includes(u.pathname)){
  file=path.join(entries.get(published).folder,'index.html');cache='no-store, no-cache, must-revalidate';
 }else{
  const entry=[...entries.values()].flatMap(e=>e.manifest.files.map(f=>({...f,folder:e.folder}))).find(f=>'/'+f.key===u.pathname);
  if(entry){file=path.join(entry.folder,entry.file);cache=entry.cacheControl;}
 }
 if(!file){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(file);const type=mime[path.extname(file)]||'application/octet-stream';
 const headers={'Content-Type':type,'Cache-Control':cache};
 if(/gzip/.test(req.headers['accept-encoding']||'')&&/javascript|text\/|svg/.test(type)){
  body=zlib.gzipSync(body);headers['Content-Encoding']='gzip';headers.Vary='Accept-Encoding';
 }
 headers['Content-Length']=body.length;res.writeHead(200,headers);res.end(body);
});
const pass=name=>{checks.push(name);console.log('PASSOU: '+name);};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/EntregaEPI/';
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{})});
 const context=await browser.newContext(),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 const responses=[];page.on('response',r=>responses.push({url:r.url(),status:r.status(),headers:r.headers()}));
 await page.goto(url);await page.waitForFunction(()=>typeof showApp==='function'&&typeof certificateWorker==='function');
 assert.equal(await page.locator('meta[name="jp-build"]').getAttribute('content'),versions[0]);
 const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.src));
 assert.ok(scripts.filter(s=>!s.includes('/config.js')).every(s=>s.includes('/releases/'+versions[0]+'/assets/')));
 assert.ok(responses.some(r=>r.url.includes('/assets/app.js')&&r.headers['content-encoding']==='gzip'));
 assert.match(await page.locator('#bioRepairLink').getAttribute('href'),/\/updates\/12\.10\.1-unico1\/JP-Biometria-Instalador-Unico\.exe$/);
 pass('Aplicativo completo abre com scripts comprimidos e versionados; instalador único preservado');
 const pdf=companyPdf();
 const parsed=await page.evaluate(async bytes=>{
  const {readCompanyPdf}=await import(appAssetBase+'company-pdf.mjs');
  return readCompanyPdf(new File([new Uint8Array(bytes)],'cnpj.pdf',{type:'application/pdf'}));
 },Array.from(pdf));
 assert.ok(parsed.fields.cnpj);assert.ok(requests.some(r=>r.path.includes('/releases/'+versions[0]+'/assets/vendor/pdfjs-5.6.205/pdf.worker.min.mjs')));
 const workerRequest=page.waitForResponse(r=>r.url().includes('/releases/'+versions[0]+'/assets/certificate-worker.js'));
 await page.evaluate(()=>{window.__cacheTestWorker=certificateWorker();});
 assert.equal((await workerRequest).status(),200);await page.evaluate(()=>window.__cacheTestWorker.close());
 pass('Leitura real de PDF sintético e carregamento do worker A1 usam a mesma versão');
 await page.evaluate(()=>{sessionStorage.setItem('cache-test-session','preserved');localStorage.setItem('jp-sidebar-collapsed','true');});
 const assetCount=()=>requests.filter(r=>r.path.includes('/releases/')).length;
 const before=assetCount();await page.goto('about:blank');await page.goto(url);
 await page.waitForFunction(()=>typeof showApp==='function');
 assert.equal(assetCount(),before,'Revisit must reuse cached assets without network requests');
 pass('Retorno ao aplicativo reutiliza os arquivos públicos sem baixá-los novamente');
 published=versions[1];
 await page.reload();await page.waitForFunction(()=>typeof showApp==='function');
 assert.equal(await page.locator('meta[name="jp-build"]').getAttribute('content'),versions[1]);
 assert.equal(await page.evaluate(()=>window.JP_CONFIG.buildSha),versions[1]);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('cache-test-session')),'preserved');
 assert.equal(await page.evaluate(()=>localStorage.getItem('jp-sidebar-collapsed')),'true');
 assert.ok((await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.src))).filter(s=>!s.includes('/config.js')).every(s=>s.includes('/releases/'+versions[1]+'/assets/')));
 assert.equal((await context.request.get(origin+'/EntregaEPI/releases/'+versions[0]+'/assets/app.js')).status(),200);
 pass('F5 recebe a nova versão com cache antigo preenchido; sessão, preferências e versão anterior preservadas');
 assert.deepEqual(errors,[]);assert.ok(!requests.some(r=>r.path.startsWith('/synthetic')),'No API or customer-data calls');
 await page.screenshot({path:path.join(output,'login-versionado.png'),fullPage:true});
 fs.writeFileSync(path.join(output,'resultados.json'),JSON.stringify({passed:true,synthetic:true,checks,requests,errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();fs.rmSync(stage,{recursive:true,force:true});});
