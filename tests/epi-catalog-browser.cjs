// Local UI + real Lambda/API/store. Synthetic report and accounts; no live APIs or reader.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{chromium}=require('playwright');
process.env.NODE_ENV='test';process.env.DATA_MODE='memory';delete process.env.TABLE_NAME;delete process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.COGNITO_ISSUER='https://cognito-idp.sa-east-1.amazonaws.com/synthetic';process.env.COGNITO_CLIENT_ID='synthetic';process.env.AUTH_COMPANY_CLAIM='custom:empresa_id';
const frontend=path.resolve(__dirname,'../frontend/EntregaEPI'),output=path.join(__dirname,'output/epi-catalog');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(frontend,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/EntregaEPI\/?/,'')||'index.html');if(!file.startsWith(frontend+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[ext]||'application/octet-stream');const data=fs.readFileSync(file);res.end(ext==='.html'?data.toString().replaceAll('__APP_PREFIX__','EntregaEPI'):data);});
let browser,fixture;const checks=[],errors=[];const pass=name=>{checks.push(name);console.log('PASSOU: '+name);};
(async()=>{
  fixture=(await import('../backend/test/helpers/epi-report-fixture.js')).reportFixture();process.env.EPI_REPORT_PATH=fixture.filePath;
  const store=await import('../backend/src/db/store.js'),{handler}=await import('../backend/src/lambda.js');
  const companies=await Promise.all(['ALFA','BETA'].map(nome=>store.create('empresa',{nome:'EMPRESA SINTÉTICA '+nome,status:'Ativa',acessoStatus:'ativo'})));
  const workers=await Promise.all(companies.map(c=>store.create('trabalhador',{empresaId:c.id,nomeCompleto:'TRABALHADOR '+c.nome,status:'Ativo'})));
  const old=await store.create('epi',{ca:'365',nomeCurto:'CAPACETE ORIGINAL',descricao:'NÃO ALTERAR',fabricante:'ORIGINAL',tamanho:'G'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const [index,role] of ['MASTER','EMPRESA'].entries()){
    const company=companies[index],worker=workers[index],claims={sub:role,iss:process.env.COGNITO_ISSUER,aud:'synthetic',exp:String(Math.floor(Date.now()/1000)+3600),token_use:'id','cognito:groups':[role],...(role==='EMPRESA'?{'custom:empresa_id':company.id}:{})};
    const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic';
    const context=await browser.newContext({viewport:{width:1366,height:950},locale:'pt-BR'});let posts=0,slowQuery=false;
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    await context.route(url=>url.origin!==origin,async route=>{
      const request=route.request(),url=new URL(request.url()),json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.hostname.startsWith('cognito-idp.'))return json(200,{AuthenticationResult:{IdToken:token,AccessToken:'synthetic',ExpiresIn:3600}});
      if(url.pathname==='/auth/resolver')return json(200,{ok:true,username:role});
      if(url.hostname==='127.0.0.1')return json(200,{ok:true,service:'JP Biometria',version:'12.10.0-bio2',sdk:true,reader:true,deviceCount:1,capabilities:{capture:true,verify:true,templates:true,documentHash:true,sharedEnrollment:true}});
      assert.ok(url.hostname.endsWith('.execute-api.sa-east-1.amazonaws.com'));
      if(url.pathname==='/health')return json(200,{ok:true,durable:true,storageReady:true});
      if(url.pathname==='/api/caepi/365')return json(200,{ok:true,item:{ca:'365',name:'CAPACETE',found:true,officialSnapshot:true,downloadedAt:'2026-10-11T12:00:00Z'}});
      if(url.pathname==='/api/epis'&&request.method()==='POST')posts++;
      if(slowQuery&&url.pathname==='/api/epis/catalogo')await new Promise(resolve=>setTimeout(resolve,400));
      const r=await handler({version:'2.0',routeKey:'ANY /{proxy+}',rawPath:url.pathname,rawQueryString:url.search.slice(1),headers:{...request.headers(),host:'synthetic.invalid'},requestContext:{requestId:randomUUID(),stage:'$default',http:{method:request.method(),path:url.pathname,protocol:'HTTP/1.1',sourceIp:'127.0.0.1'},authorizer:{jwt:{claims}}},isBase64Encoded:false,...(request.postData()?{body:request.postData()}:{})},{});return json(r.statusCode,JSON.parse(r.body));
    });
    const page=await context.newPage();await page.goto(origin+'/EntregaEPI/');await page.locator('#username').fill(role);await page.locator('#password').fill('SenhaSintetica8');await page.locator('#loginButton').click();
    await page.waitForFunction(()=>document.getElementById('metricEpis').textContent==='42');
    if(role==='MASTER')await page.locator('#empresaAtivaSelect').selectOption(company.id);
    await page.waitForFunction(id=>document.querySelector(`#entregaTrabalhador option[value="${id}"]`),worker.id);
    await page.evaluate(()=>goScreen('epis'));await page.locator('#caInput').fill('CA 365');await page.locator('#consultarCaButton').click();
    await page.waitForFunction(()=>document.getElementById('caMessage').textContent==='EPI já cadastrado');assert.ok(await page.locator('#epiForm button[type=submit]').isDisabled());assert.equal(posts,0);
    await page.screenshot({path:path.join(output,`${role}-ca-cadastrado.png`),fullPage:true});
    await page.locator('#epiUseExisting').click();assert.equal(await page.locator('#entregaEpi').inputValue(),old.id);assert.equal((await store.get('epi',old.id)).descricao,'NÃO ALTERAR');
    pass(role+': CA existente bloqueia cadastro e pode ser usado sem novo registro');
    await page.evaluate(()=>goScreen('epis'));await page.locator('#openEquipmentCatalog').click();await page.waitForFunction(()=>document.querySelectorAll('.epi-catalog-row').length===15);
    await page.locator('#catalogNext').click();await page.waitForFunction(()=>document.getElementById('catalogPage').textContent.startsWith('Página 2'));
    await page.locator('#catalogQuery').fill('oculos fabrica');await page.waitForFunction(()=>document.getElementById('catalogPage').textContent.includes('40 equipamentos'));assert.equal(await page.locator('.epi-catalog-row').count(),15);
    await page.screenshot({path:path.join(output,`${role}-catalogo.png`),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await page.locator('.epi-catalog-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(output,`${role}-catalogo-celular.png`),fullPage:true});
    await page.locator('#catalogQuery').fill('999');await page.waitForFunction(()=>document.querySelectorAll('.epi-catalog-row').length===1);assert.ok(await page.locator('[data-catalog-select]').isDisabled());
    await page.locator('#catalogQuery').fill('100');await page.waitForFunction(()=>document.querySelector('[data-catalog-select]')?.dataset.catalogSelect.endsWith('-100'));
    await page.locator('[data-catalog-detail]').click();await page.locator('.epi-catalog-detail summary').click();assert.ok((await page.locator('.epi-catalog-technical p').innerText()).length>2400);await page.locator('.epi-catalog-detail .dialog-close').click();
    await page.locator('[data-catalog-select]').click();assert.equal(await page.locator('#entregaEpi').inputValue(),fixture.id('100'));await page.locator('#entregaTrabalhador').selectOption(worker.id);await page.locator('#entregaQuantidade').fill('3');await page.locator('#entregaForm button[type=submit]').click();await page.waitForSelector('.ficha-row');
    const ficha=(await store.list('ficha',company.id))[0];assert.equal(ficha.itens[0].epiDescricao,'ÓCULOS DE PROTEÇÃO 0');assert.equal(ficha.itens[0].quantidade,3);assert.equal(posts,0);
    pass(role+': catálogo paginado responsivo, detalhes completos e ficha gerada com nome curto');
    await page.setViewportSize({width:1366,height:950});await page.evaluate(()=>goScreen('epis'));slowQuery=true;await page.locator('#openEquipmentCatalog').click();await page.evaluate(()=>document.getElementById('logoutButton').click());await page.waitForTimeout(550);assert.equal(await page.locator('dialog[open]').count(),0);pass(role+': resposta atrasada descartada ao sair');
    await context.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'resultados.json'),JSON.stringify({syntheticData:true,realApi:true,physicalReader:false,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();fixture?.cleanup();});
