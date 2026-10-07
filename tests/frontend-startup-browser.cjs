// Real browser and application; external services/USB are explicitly synthetic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../frontend/EntregaEPI');
const output=path.resolve(__dirname,'output/startup');fs.mkdirSync(output,{recursive:true});
const report={synthetic:true,physicalReaderTested:false,checks:[]};
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.replace(/^\/EntregaEPI\/?/,'')||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file).toString().replaceAll('__APP_PREFIX__','EntregaEPI'));
});
let browser,origin;
const pass=name=>{report.checks.push({name,passed:true});console.log('PASSOU: '+name);};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function scenario(options={}){
  const state={permission:'granted',bio:'ready',health:'ready',ca:'ready',...options,requests:[],starts:0,errors:[]};
  const context=await browser.newContext({viewport:{width:1366,height:1000},locale:'pt-BR',timezoneId:'America/Cuiaba',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36'});
  await context.exposeBinding('__protocolStart',()=>{state.starts++;if(state.bio==='recover')setTimeout(()=>state.bio='ready',state.startDelay||0);});
  await context.addInitScript(permission=>{
    window.__permission=permission;
    Object.defineProperty(navigator.permissions,'query',{value:async()=>({state:window.__permission})});
    new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.tagName==='IFRAME'&&node.getAttribute('src')==='jpbiometria://start')window.__protocolStart();}).observe(document,{childList:true,subtree:true});
  },state.permission);
  const page=await context.newPage();page.on('pageerror',error=>state.errors.push(error.message));
  await context.route(url=>url.origin!==origin,async route=>{
    const request=route.request(),url=new URL(request.url());
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    state.requests.push({path:url.pathname,host:url.hostname,port:url.port,method:request.method(),headers:request.headers()});
    if(url.hostname.startsWith('cognito-idp.')){
      const input=request.postDataJSON();state.username=input.AuthParameters?.USERNAME||input.ChallengeResponses?.USERNAME;
      if(state.challenge&&input.AuthFlow)return json({ChallengeName:'NEW_PASSWORD_REQUIRED',Session:'SYNTHETIC',ChallengeParameters:{requiredAttributes:'[]'}});
      const token=encode({alg:'RS256'})+'.'+encode({'cognito:groups':[state.username==='MASTER-TESTE'?'MASTER':'EMPRESA'],'custom:empresaId':'EMPRESA-A',sub:state.username})+'.SYNTHETIC';
      return json({AuthenticationResult:{IdToken:token,ExpiresIn:3600}});
    }
    if(url.hostname==='127.0.0.1'){
      assert.equal(url.pathname,'/status','automatic routine must not capture');assert.equal(request.method(),'GET');
      assert.equal(request.headers().authorization,undefined);assert.equal(request.headers()['x-empresa-id'],undefined);
      if(state.holdBio){state.holdBio=false;await new Promise(resolve=>state.releaseBio=resolve);return json({ok:true,service:'JP Biometria',version:'12.8.2',reader:true,sdk:true,deviceCount:1,capabilities:{capture:true,captureMethod:'POST',capturePath:'/api/capture',verify:true,templates:true}});}
      if(url.port!=='8789'||['offline','recover'].includes(state.bio))return route.abort();
      const sdk=state.bio!=='sdk';
      return json({ok:sdk,service:'JP Biometria',version:'12.8.2',reader:sdk,sdk,deviceCount:sdk?1:0,errorCode:sdk?'':'SDK_NOT_FOUND',capabilities:{capture:sdk,captureMethod:'POST',capturePath:'/api/capture',verify:true,templates:true}});
    }
    assert.ok(url.hostname.endsWith('.execute-api.sa-east-1.amazonaws.com'));
    assert.equal(request.method(),'GET','login verification does not mutate records');
    if(url.pathname==='/health'){
      if(state.holdHealth){state.holdHealth=false;await new Promise(resolve=>state.releaseHealth=resolve);return json({ok:true,durable:true,storageReady:true});}
      return json({ok:state.health==='ready',durable:true,storageReady:state.health==='ready'},state.health==='ready'?200:503);
    }
    if(url.pathname==='/api/caepi/365')return json({ok:true,item:{found:true,officialSnapshot:true,downloadedAt:'2026-10-06T16:00:00Z',ambiguous:state.ca!=='ready',autofillAllowed:state.ca==='ready'}});
    if(url.pathname==='/api/empresas')return json({ok:true,items:[{id:'EMPRESA-A',nome:'EMPRESA DE DEMONSTRAÇÃO',cnpj:'00000000000000'},{id:'EMPRESA-B',nome:'SEGUNDA EMPRESA SINTÉTICA',cnpj:'11111111111111'}].slice(0,state.username==='MASTER-TESTE'?2:1)});
    if(['/api/trabalhadores','/api/fichas','/api/epis'].includes(url.pathname))return json({ok:true,items:[]});
    throw new Error('Unexpected route '+url.pathname);
  });
  const login=async(user='MASTER-TESTE')=>{await page.locator('#username').fill(user);await page.locator('#password').fill('SENHA-SINTETICA');await page.locator('#loginButton').click();};
  const done=()=>page.waitForFunction(()=>!document.getElementById('startupRetryButton').disabled&&document.getElementById('startupCheckedAt').textContent.startsWith('Última rotina:'));
  const snapshot=async name=>{
    await page.evaluate(()=>goScreen('config'));
    await page.evaluate(()=>{document.getElementById('syntheticDemoLabel')?.remove();const label=document.createElement('p');label.id='syntheticDemoLabel';label.textContent='DEMONSTRAÇÃO COM SERVIÇOS SIMULADOS • sem leitor USB físico';label.style.cssText='padding:12px;background:#fff3c4;color:#362500;font-weight:bold';document.getElementById('startupTitle').closest('section').prepend(label);});
    const bounds=await page.locator('.startup-checks').boundingBox();
    if(bounds.height+250>page.viewportSize().height)await page.setViewportSize({width:page.viewportSize().width,height:Math.ceil(bounds.height+250)});
    await page.locator('.startup-checks').screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
  };
  const close=async()=>{state.releaseBio?.();state.releaseHealth?.();assert.deepEqual(state.errors,[]);await context.close();};
  await page.goto(origin+'/EntregaEPI/');
  return {state,context,page,login,done,snapshot,close};
}
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});report.browser=browser.version();
  for(const user of ['MASTER-TESTE','CLIENTE-TESTE']){
    const s=await scenario();assert.equal(s.state.requests.length,0);await s.login(user);await s.done();
    for(const id of ['startupApiBadge','startupCaBadge','startupBioBadge'])assert.equal(await s.page.locator('#'+id).getAttribute('data-state'),'success');
    assert.match(await s.page.locator('#startupCaText').innerText(),/06\/10\/2026.*MTE/);
    assert.equal(s.state.starts,0);for(const route of ['/health','/api/caepi/365','/status'])assert.equal(s.state.requests.filter(r=>r.path===route).length,1);
    await s.page.locator('#refreshButton').click();await s.page.waitForTimeout(100);assert.equal(s.state.requests.filter(r=>r.path==='/status').length,1);
    if(user.startsWith('MASTER')){await s.page.locator('#empresaAtivaSelect').selectOption('EMPRESA-B');assert.equal(s.state.requests.filter(r=>r.path==='/status').length,1);}
    await s.snapshot(user.startsWith('MASTER')?'01-master-automatico':'02-cliente-automatico');
    await s.page.reload();await s.done();assert.equal(s.state.requests.filter(r=>r.path==='/status').length,2);
    pass(user+': login e sessão restaurada verificam os três serviços; navegação e troca de empresa não repetem a rotina');await s.close();
  }
  {
    const s=await scenario({bio:'recover',startDelay:4200});await s.login();await s.done();assert.equal(s.state.starts,1);assert.equal(await s.page.locator('#startupBioBadge').getAttribute('data-state'),'success');pass('agente parado com início demorado: uma solicitação de abertura e nova verificação automática, sem captura');await s.close();
  }
  {
    const s=await scenario({bio:'sdk',health:'unavailable',ca:'ambiguous'});await s.login();await s.done();assert.equal(s.state.starts,1);assert.match(await s.page.locator('#startupBioText').innerText(),/SDK eNBioBSP/);assert.equal(await s.page.locator('#startupApiBadge').getAttribute('data-state'),'error');assert.equal(await s.page.locator('#startupCaBadge').getAttribute('data-state'),'warning');await s.snapshot('03-diagnostico-sdk');await s.page.setViewportSize({width:390,height:844});assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await s.snapshot('04-diagnostico-mobile');pass('SDK ausente, falha de armazenamento e CA ambíguo são informados sem bloquear o Dashboard');await s.close();
  }
  for(const permission of ['prompt','denied','unsupported']){
    const s=await scenario({permission});await s.login();await s.done();assert.equal(s.state.requests.filter(r=>r.path==='/status').length,0);assert.equal(s.state.starts,0);
    if(permission==='prompt'){await s.page.evaluate(()=>window.__permission='granted');await s.page.evaluate(()=>goScreen('config'));await s.page.locator('#startupBioButton').click();await s.page.waitForFunction(()=>document.getElementById('startupBioBadge').dataset.state==='success');}
    pass('permissão '+permission+': diagnóstico claro e nenhuma consulta local sem autorização; botão permite continuar');await s.close();
  }
  {
    const s=await scenario({challenge:true});await s.login('CLIENTE-TESTE');await s.page.locator('#newPasswordForm').waitFor({state:'visible'});assert.equal(s.state.requests.filter(r=>['/health','/api/caepi/365','/status'].includes(r.path)).length,0);
    await s.page.locator('#newPassword').fill('SenhaSintetica42');await s.page.locator('#newPasswordConfirm').fill('SenhaSintetica42');await s.page.locator('#newPasswordButton').click();await s.done();pass('primeiro acesso só verifica após concluir a troca de senha e a autenticação');await s.close();
  }
  {
    const s=await scenario({holdHealth:true,holdBio:true});await s.login();await s.page.waitForFunction(()=>document.getElementById('metricEmpresas').textContent==='2');
    for(let i=0;(!s.state.releaseHealth||!s.state.releaseBio)&&i<50;i++)await s.page.waitForTimeout(20);
    assert.ok(s.state.releaseHealth&&s.state.releaseBio);await s.page.locator('#logoutButton').click();
    s.state.health='unavailable';s.state.bio='sdk';await s.login('CLIENTE-TESTE');await s.done();s.state.releaseHealth();s.state.releaseBio();await s.page.waitForTimeout(150);
    assert.equal(await s.page.locator('#startupApiBadge').getAttribute('data-state'),'error');assert.match(await s.page.locator('#startupBioText').innerText(),/SDK eNBioBSP/);assert.equal(await s.page.locator('#configProfile').innerText(),'Empresa');pass('logout cancela verificações e respostas tardias não alteram o diagnóstico do próximo cliente');await s.close();
  }
  {
    const s=await scenario({holdHealth:true});await s.login();await s.done();assert.equal(await s.page.locator('#startupApiBadge').getAttribute('data-state'),'error');assert.equal(await s.page.locator('#startupBioBadge').getAttribute('data-state'),'success');pass('serviço sem resposta termina em 12 segundos; CA e biometria concluem independentemente');await s.close();
  }
  report.passed=true;
}
main().catch(error=>{report.error=error.message;report.passed=false;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(output,'resultados.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();server.close();});
