const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../frontend/EntregaEPI'),output=path.join(__dirname,'output/jpged');fs.mkdirSync(output,{recursive:true});
const company={id:'companyA',nome:'EMPRESA SINTÉTICA',cnpj:'12345678000195',status:'Ativa'},other={id:'companyB',nome:'OUTRA EMPRESA',status:'Ativa'};
const document={id:'doc',numero:'TESTE-001',trabalhadorNome:'COLABORADOR SINTÉTICO',tipo:'Entrega e Devolução',data:'10/10/2026',certifiedAt:'2026-10-10T10:00:00Z'};
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/EntregaEPI\/?/,'')||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');let data=fs.readFileSync(file);if(file.endsWith('.html'))data=data.toString().replaceAll('__APP_PREFIX__','EntregaEPI');res.end(data);});
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{})});
  for(const master of [true,false]){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    let revision=null,fail=true,updates=0,biometricCalls=0;const downloads=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
    await context.addInitScript(()=>Object.defineProperty(navigator.permissions,'query',{value:async()=>({state:'granted'})}));
    const claims={sub:master?'master-synthetic':'client-synthetic',token_use:'id','cognito:groups':master?['MASTER']:[],'custom:empresa_id':'companyA',exp:Math.floor(Date.now()/1000)+3600,auth_time:Math.floor(Date.now()/1000)};
    await context.route(url=>url.origin!==origin,async route=>{
      const req=route.request(),u=new URL(req.url()),answer=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}),companyId=req.headers()['x-empresa-id'];
      if(u.hostname.startsWith('cognito-idp.'))return answer({AuthenticationResult:{IdToken:`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`,AccessToken:'synthetic',ExpiresIn:3600}});
      if(u.pathname==='/auth/resolver')return answer({ok:true,username:'synthetic'});
      if(u.hostname==='127.0.0.1'){if(u.pathname==='/status')return route.abort('connectionrefused');biometricCalls++;throw Error('Unexpected native operation');}
      if(u.hostname.startsWith('jpged-documentos-'))return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF SYNTHETIC')});
      if(u.pathname==='/health')return answer({ok:true,durable:true,storageReady:true});
      if(u.pathname==='/api/caepi/365')return answer({ok:true,item:{found:true,officialSnapshot:true,downloadedAt:'2026-10-10T00:00:00Z'}});
      if(u.pathname==='/api/empresas')return answer({ok:true,items:master?[company,other]:[company]});
      if(['/api/epis','/api/trabalhadores','/api/fichas'].includes(u.pathname))return answer({ok:true,items:[]});
      if(u.pathname==='/api/jpged/certificado')return answer({ok:true,certificate:{mode:'vault',vaultState:'Enabled',subject:'SYNTHETIC',validTo:'2099-01-01'}});
      if(u.pathname==='/api/jpged/documentos')return answer({ok:true,items:companyId==='companyA'?[{...document,compactRevision:revision}]:[],cursor:''});
      if(u.pathname.endsWith('/atualizar-layout')){assert.equal(companyId,'companyA');assert.deepEqual(req.postDataJSON(),{});updates++;await new Promise(r=>setTimeout(r,250));if(fail)return answer({ok:false,error:'Cofre temporariamente indisponível. O original foi preservado.'},503);revision={layoutVersion:'compact-1',certifiedAt:'2026-10-11T12:30:00Z',pdfHash:'a'.repeat(64)};return answer({ok:true,completed:true,documentId:'doc',revision});}
      if(u.pathname.endsWith('/download')){downloads.push(u.searchParams.get('versao'));return answer({ok:true,url:'https://jpged-documentos-003020057405.s3.sa-east-1.amazonaws.com/synthetic.pdf'});}
      throw Error('Unexpected API '+u.pathname);
    });
    await page.goto(origin+'/EntregaEPI/');await page.locator('#username').fill('SYNTHETIC');await page.locator('#password').fill('SYNTHETIC');await page.locator('#loginButton').click();await page.waitForSelector('#appShell:not(.hidden)');await page.waitForFunction(()=>cache.empresas.length>0);
    if(master)await page.selectOption('#empresaAtivaSelect','companyA');
    await page.evaluate(()=>goScreen('jpged'));await page.waitForSelector('[data-layout="doc"]');
    await page.locator('[data-layout="doc"]').click();await page.waitForFunction(()=>operationControllers.size>0);
    assert.equal(await page.locator('[data-layout="doc"]').isDisabled(),true);
    await page.waitForFunction(()=>document.getElementById('appMessage').textContent.includes('original foi preservado'));
    assert.equal(await page.locator('[data-jpged="doc"]').textContent(),'Baixar PDF original');assert.equal(await page.locator('[data-layout="doc"]').isEnabled(),true);
    await page.evaluate(()=>{jpgedCursor='synthetic-next-page';renderJpged();});
    fail=false;await page.locator('[data-layout="doc"]').click();await page.waitForSelector('[data-original="true"]');
    assert.equal(await page.evaluate(()=>jpgedCursor),'synthetic-next-page');assert.equal(await page.locator('#appMessage').getAttribute('class'),'message success');
    assert.equal(await page.locator('[data-layout]').count(),0);assert.match(await page.locator('#jpgedList').textContent(),/Impressão compacta certificada/);
    await page.locator('[data-jpged="doc"]:not([data-original])').click();await page.locator('[data-original="true"]').click();assert.deepEqual(downloads,[null,'original']);
    assert.equal(biometricCalls,0);assert.equal(updates,2);assert.equal(await page.evaluate(()=>operationControllers.size),0);
    await page.screenshot({path:path.join(output,master?'layout-master.png':'layout-cliente.png'),fullPage:true});
    if(master){await page.selectOption('#empresaAtivaSelect','companyB');await page.waitForFunction(()=>document.getElementById('jpgedList').textContent.includes('Nenhum documento'));assert.equal(await page.locator('[data-jpged]').count(),0);}
    else{await page.setViewportSize({width:390,height:844});await page.evaluate(()=>setSidebarOpen(false));await page.waitForFunction(()=>document.getElementById('primarySidebar').getBoundingClientRect().right<=1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,'layout-cliente-mobile.png'),fullPage:true});}
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: Master e cliente; falha/retry; PDF atualizado e anterior; isolamento de empresa; mobile; zero capturas biométricas.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
