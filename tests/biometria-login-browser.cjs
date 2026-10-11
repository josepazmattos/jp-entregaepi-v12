// Actual UI and Lambda handler; Cognito, IPs and readers are synthetic.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {generateKeyPairSync,sign,randomUUID}=require('node:crypto');
process.env.NODE_ENV='test';process.env.DATA_MODE='memory';delete process.env.TABLE_NAME;delete process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.COGNITO_ISSUER='https://cognito-idp.sa-east-1.amazonaws.com/synthetic';process.env.COGNITO_CLIENT_ID='synthetic';process.env.AUTH_COMPANY_CLAIM='custom:empresa_id';
const root=path.resolve(__dirname,'../frontend/EntregaEPI'),output=path.join(__dirname,'output/biometria-login');fs.mkdirSync(output,{recursive:true});
const report={synthetic:true,physicalReaderTested:false,checks:[]},pass=name=>{report.checks.push(name);console.log('PASSOU: '+name);};
const server=http.createServer((req,res)=>{const file=path.resolve(root,new URL(req.url,'http://local').pathname.replace(/^\/EntregaEPI\/?/,'')||'index.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[ext]||'application/octet-stream');let data=fs.readFileSync(file);if(ext==='.html')data=data.toString().replaceAll('__APP_PREFIX__','EntregaEPI');res.end(data);});
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const template='SYNTHETIC_TEMPLATE_NO_REAL_BIOMETRY_'.repeat(3),keyPair=()=>{const p=generateKeyPairSync('ec',{namedCurve:'prime256v1'});return {...p,key:p.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
let browser;
(async()=>{
 const store=await import('../backend/src/db/store.js'),{handler}=await import('../backend/src/lambda.js'),{createBiometricsService,hash}=await import('../backend/src/services/biometria.service.js');
 const a=keyPair(),b=keyPair(),company=await store.create('empresa',{nome:'EMPRESA SINTÉTICA',cnpj:'00000000000000',status:'Ativa'}),bio=createBiometricsService(store),fichas=[];
 const attest=(p,c)=>{const proof=JSON.stringify({v:1,kind:c.kind,challengeId:c.challengeId,workerId:c.workerId,fichaId:c.fichaId,fingerCode:c.fingerCode,documentHash:c.documentHash,templateHash:hash(template),imageHash:hash(Buffer.from(PNG.split(',')[1],'base64')),...(c.kind==='enroll'?{enrolled:true}:{matched:true})});return {ok:true,challengeId:c.challengeId,template,publicKey:p.key,proof,proofSignature:sign('sha256',Buffer.from(proof),p.privateKey).toString('base64'),fingerImageDataUrl:PNG,matched:true,realFingerImage:true};};
 for(let i=0;i<2;i++){
  let worker=await store.create('trabalhador',{empresaId:company.id,nomeCompleto:'COLABORADOR SINTÉTICO '+i,status:'Ativo',cpf:'00000000000'});
  const c=await bio.challenge({worker,actor:'previous-enrollment',kind:'enroll',fingerCode:'R_INDEX'});await bio.complete({worker,actor:'previous-enrollment',kind:'enroll',body:attest(a,c)});
  fichas.push(await store.create('ficha',{empresaId:company.id,trabalhadorId:worker.id,trabalhadorNome:worker.nomeCompleto,numero:'SINTÉTICA-'+i,status:'pendente',tipo:'Entrega',data:'11/10/2026',itens:[{epiNome:'Capacete',quantidade:1,ca:'365',datasMovimentacao:{entrega:'11/10/2026'}}]}));
 }
 const claims={sub:'same-company-account',iss:process.env.COGNITO_ISSUER,aud:'synthetic',exp:Math.floor(Date.now()/1000)+3600,token_use:'id','cognito:groups':['EMPRESA'],'custom:empresa_id':company.id};
 const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic';
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{}),headless:true,args:['--no-sandbox']});
 async function session(pair,legacy,ip){
  const state={logins:0,captures:0,match:false,deviceCalls:0,errors:[]},context=await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR'});
  context.on('page',p=>p.on('pageerror',e=>state.errors.push(e.message)));
  await context.addInitScript(()=>Object.defineProperty(navigator.permissions,'query',{value:async()=>({state:'granted'})}));
  await context.route(url=>url.origin!==origin,async route=>{
   const request=route.request(),url=new URL(request.url()),json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/auth/resolver')return json({ok:true,username:'EMPRESA-TESTE'});
   if(url.hostname.startsWith('cognito-idp.')){state.logins++;return json({AuthenticationResult:{IdToken:token,AccessToken:'synthetic',ExpiresIn:3600}});}
   if(url.hostname==='127.0.0.1'){
    if(url.port!=='8789')return route.abort();
    if(url.pathname==='/status')return json({ok:true,service:'JP Biometria',version:legacy?'12.10.0-bio1':'12.10.0-bio2',reader:true,sdk:true,deviceCount:1,...(!legacy?{biometricPublicKey:pair.key}:{}),capabilities:{capture:true,captureMethod:'POST',capturePath:'/api/capture',templates:true,verify:true,documentHash:true,sharedEnrollment:!legacy}});
    assert.equal(url.pathname,'/api/signature','nenhuma autorização de dispositivo ou novo cadastro pode ser solicitado');const c=request.postDataJSON();assert.equal(c.publicKey,pair.key);assert.equal(c.template,template);assert.equal(c.fingerCode,'R_INDEX');state.captures++;
    if(!state.match)return json({ok:false,errorCode:'BIOMETRIA_DIVERGENTE'},422);return json(attest(pair,c));
   }
   if(url.pathname.startsWith('/api/biometria/dispositivos'))state.deviceCalls++;
   if(url.pathname==='/health')return json({ok:true,durable:true,storageReady:true});
   if(url.pathname==='/api/caepi/365')return json({ok:true,item:{found:true,officialSnapshot:true,autofillAllowed:true}});
   assert.ok(url.hostname.endsWith('.execute-api.sa-east-1.amazonaws.com'));
   const response=await handler({version:'2.0',routeKey:'ANY /{proxy+}',rawPath:url.pathname,rawQueryString:url.search.slice(1),headers:{...request.headers(),host:'synthetic.invalid'},requestContext:{requestId:randomUUID(),stage:'$default',http:{method:request.method(),path:url.pathname,protocol:'HTTP/1.1',sourceIp:ip},authorizer:{jwt:{claims}}},isBase64Encoded:false,...(request.postData()?{body:request.postData()}:{})},{});
   return json(JSON.parse(response.body),response.statusCode);
  });
  const page=await context.newPage();await page.goto(origin+'/EntregaEPI/');await page.locator('#username').fill('EMPRESA-TESTE');await page.locator('#password').fill('SENHA-SINTETICA');await page.locator('#loginButton').click();await page.waitForFunction(()=>document.getElementById('appShell').classList.contains('hidden')===false&&document.getElementById('startupRetryButton').disabled===false);
  await page.evaluate(()=>goScreen('biometria'));assert.equal(await page.getByRole('button',{name:'Autorizar este computador',exact:true}).count(),0);assert.equal(await page.locator('#biometricDevicesCard').count(),0);
  assert.equal(await page.locator('.nav [data-screen="empresas"]').isVisible(),false);assert.equal(await page.locator('.nav [data-screen="certificado"]').isVisible(),false);
  await page.evaluate(()=>goScreen('fichas'));await page.waitForSelector('[data-ficha-id]');
  return {state,context,page};
 }
 const sessions=await Promise.all([session(a,true,'192.0.2.10'),session(b,false,'198.51.100.20')]),popups=[];
 for(let i=0;i<2;i++){
  const s=sessions[i],opened=s.context.waitForEvent('page');await s.page.locator(`[data-ficha-id="${fichas[i].id}"]`).click();const popup=await opened;await popup.locator('#signDocument').click();await popup.waitForSelector('#verifyFingerprint');assert.equal(await popup.locator('#operationFinger option').count(),1);popups.push(popup);
 }
 await popups[1].locator('#verifyFingerprint').click();await popups[1].waitForFunction(()=>document.querySelector('.dialog-message')?.textContent.includes('não corresponde'));assert.equal((await store.get('ficha',fichas[1].id)).status,'pendente');pass('Outro computador bloqueia digital divergente sem autorização Master e sem alterar cadastro');
 sessions.forEach(s=>s.state.match=true);
 await Promise.all(popups.map(async popup=>{await popup.locator('#verifyFingerprint').click();await popup.waitForSelector('dialog',{state:'detached'});}));
 for(let i=0;i<2;i++){
  const signed=await store.get('ficha',fichas[i].id);assert.equal(signed.status,'assinada');assert.equal(signed.assinaturaBiometrica.publicKey,[a,b][i].key);assert.equal(sessions[i].state.logins,1);assert.equal(sessions[i].state.deviceCalls,0);assert.deepEqual(sessions[i].state.errors,[]);
 }
 const records=await store.list('biometria',company.id);assert.equal(records.length,2);assert.ok(records.every(x=>x.publicKey===a.key&&x.template===template));
 pass('Dois navegadores com o mesmo login e IPs simulados distintos assinam sem nova senha, cadastro de máquina ou recadastro de digitais');
 pass('Agente bio1 preserva leitura no computador original; bio2 usa cadastro compartilhado em outro computador');
 await sessions[0].page.locator('#logoutButton').click();await sessions[1].page.reload();await sessions[1].page.waitForSelector('#appShell:not(.hidden)');assert.equal(sessions[1].state.logins,1);pass('Logout em uma máquina não encerra a outra sessão');
 await sessions[1].page.evaluate(()=>goScreen('biometria'));await sessions[1].page.screenshot({path:path.join(output,'login-suficiente-sem-autorizacao.png'),fullPage:true});
 report.passed=true;
})().catch(error=>{report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));await browser?.close();server.close();});
