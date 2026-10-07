// Fluxo de captura exercitado no navegador com agente/API inteiramente sintéticos.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
module.exports=async function runBiometricBrowser({browser,origin,output}){
  const checks=[],errors=[],requests=[],registrations=[];
  const report={passed:false,checks,synthetic:true,physicalReaderTested:false};
  const companies=[{id:'BIO-EMPRESA-A',nome:'EMPRESA ALFA SINTÉTICA',cnpj:'00000000000000',localidade:'Cidade de Teste',uf:'MS'},{id:'BIO-EMPRESA-B',nome:'EMPRESA BETA SINTÉTICA',cnpj:'11111111111111'}];
  const workers=companies.map((company,index)=>({id:'BIO-TRABALHADOR-'+index,empresaId:company.id,nomeCompleto:index?'TRABALHADOR BETA SINTÉTICO':'TRABALHADOR ALFA SINTÉTICO',cpf:'00000000000',funcao:'FUNÇÃO DE TESTE',matriculaESocial:'000ABC123'}));
  const equipment={id:'BIO-EPI',descricao:'EQUIPAMENTO SINTÉTICO',ca:'00000'};
  const fichas=[0,1,2].map((index)=>{const company=companies[index===2?1:0],worker=workers[index===2?1:0];return {id:'BIO-FICHA-'+index,numero:'EPI-BIO-SINTÉTICA-'+index,empresaId:company.id,trabalhadorId:worker.id,trabalhadorNome:worker.nomeCompleto,empresaSnapshot:company,trabalhadorSnapshot:worker,data:'07/10/2026',tipo:'Entrega',status:'pendente',itens:[{epiId:equipment.id,epiDescricao:equipment.descricao,ca:equipment.ca,quantidade:1}]};});
  const encode=object=>Buffer.from(JSON.stringify(object)).toString('base64url');
  const token=`${encode({alg:'RS256'})}.${encode({sub:'BIO-USUARIO-SINTETICO','cognito:groups':['MASTER'],exp:4102444800})}.TOKEN-SINTETICO`;
  let statusMode='ready',captureMode='ready',releaseCapture=null,commitCount=0,loseFirstReply=true;
  const context=await browser.newContext({viewport:{width:1366,height:900},locale:'pt-BR'});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const passed=message=>{checks.push(message);console.log('PASSOU: '+message);};
  async function noStoredBiometrics(){const stored=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));assert.ok(!stored.includes('data:image/'));assert.ok(!stored.includes('TEMPLATE-SINTETICO-PRIVADO'));}
  await context.route(url=>url.origin!==origin,async route=>{
    const request=route.request(),url=new URL(request.url());
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(url.hostname==='127.0.0.1'&&Number(url.port)>=8789&&Number(url.port)<=8799){
      assert.equal(request.headers().authorization,undefined);assert.equal(request.headers()['x-empresa-id'],undefined);
      requests.push({port:Number(url.port),path:url.pathname,query:Object.fromEntries(url.searchParams)});
      if(url.pathname==='/status'){
        if(statusMode==='wrong')return json({ok:true,service:'SERVICO-SINTETICO-DIFERENTE',template:'TEMPLATE-SINTETICO-PRIVADO',image:pixel});
        if(statusMode==='alternative'&&url.port!=='8790')return route.abort();
        if(statusMode!=='alternative'&&url.port!=='8789')return route.abort();
        return json({ok:statusMode!=='missing',service:'JP Biometria Local Java',version:'12.8.1',capabilities:{capture:true,captureMethod:'POST',capturePath:'/api/capture'},sdk:true,reader:statusMode!=='missing',deviceCount:statusMode==='missing'?0:1,deviceName:'NITGEN HFDU06',log:'NAO-EXIBIR-LOG'});
      }
      if(url.pathname==='/api/capture'||url.pathname==='/capture'){
        assert.equal(request.method(),'POST');assert.match(request.headers()['content-type'],/^text\/plain/);const command=request.postDataJSON();assert.equal(command.requireTemplate,false);assert.equal(command.requireRealImage,true);assert.equal(command.workerId,undefined);
        if(captureMode==='fallback'&&url.pathname==='/api/capture')return json({},404);
        if(captureMode==='invalid')return json({ok:true,realFingerImage:true,fingerImageDataUrl:'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,...Array(24).fill(0)]).toString('base64')});
        if(captureMode==='hold')await new Promise(resolve=>{releaseCapture=resolve;});
        try{return await json({ok:true,realFingerImage:true,fingerImageDataUrl:pixel,template:'TEMPLATE-SINTETICO-PRIVADO',matched:true,matchScore:'Conferido'});}catch(error){return;}
      }
      throw new Error('Rota local não prevista: '+url.pathname);
    }
    if(url.hostname.startsWith('cognito-idp.'))return json({AuthenticationResult:{IdToken:token,AccessToken:'ACCESS-SINTETICO',ExpiresIn:3600}});
    if(!url.hostname.endsWith('.execute-api.sa-east-1.amazonaws.com'))throw new Error('Conexão externa não prevista no teste biométrico');
    assert.equal(request.headers().authorization,'Bearer '+token);
    const company=request.headers()['x-empresa-id'];
    if(request.method()==='GET'){
      if(url.pathname==='/api/empresas')return json({ok:true,items:companies});
      if(url.pathname==='/api/trabalhadores')return json({ok:true,items:workers.filter(worker=>worker.empresaId===company)});
      if(url.pathname==='/api/epis')return json({ok:true,items:[equipment]});
      if(url.pathname==='/api/fichas')return json({ok:true,items:fichas.filter(ficha=>ficha.empresaId===company)});
    }
    const signing=/^\/api\/fichas\/([^/]+)\/assinar$/.exec(url.pathname);
    if(signing&&request.method()==='POST'){
      const body=request.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['captureRequestId','fingerCode','fingerImageDataUrl']);assert.match(body.captureRequestId,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);assert.equal(body.fingerImageDataUrl,pixel);
      const ficha=fichas.find(item=>item.id===signing[1]);assert.equal(ficha.empresaId,company);registrations.push(body);
      if(ficha.status==='pendente'){ficha.status='assinada';ficha.assinaturaStatus='registrada_sem_verificacao_biometrica';ficha.assinaturaBiometrica={realFingerImage:body.fingerImageDataUrl,dedo:body.fingerCode,verificada:false,metodo:'captura_de_imagem',id:'CAPTURA-SINTETICA',signedAt:'2026-10-07T03:00:00Z'};commitCount++;}
      if(loseFirstReply){loseFirstReply=false;return route.abort();}
      return json({ok:true,item:ficha});
    }
    throw new Error('Rota de API não prevista no teste biométrico: '+url.pathname);
  });
  async function login(){await page.locator('#username').fill('BIO-USUARIO-SINTETICO');await page.locator('#password').fill('SENHA-SINTETICA');await page.locator('#loginButton').click();await page.waitForFunction(()=>document.getElementById('metricEmpresas').textContent==='2');}
  async function navigate(screen){if(await page.locator('#menuToggle').isVisible())await page.locator('#menuToggle').click();await page.locator(`.nav [data-screen="${screen}"]`).click();}
  async function captured(){await page.locator('#bioCaptureImage').waitFor({state:'visible'});assert.equal(await page.locator('#bioCaptureImage').evaluate(image=>image.complete&&image.naturalWidth>0),true);}
  async function discarded(){await page.locator('#bioCapturePanel').waitFor({state:'hidden'});assert.equal(await page.locator('#bioCaptureImage').getAttribute('src'),null);await noStoredBiometrics();}
  async function startHeld(fichaId){captureMode='hold';releaseCapture=null;await navigate('fichas');await page.locator(`[data-capture-ficha-id="${fichaId}"]`).click();await page.locator('#bioCaptureButton').click();for(let attempt=0;!releaseCapture&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(releaseCapture,'o pedido de captura chegou ao agente sintético');}
  try{
    await page.goto(origin+'/EntregaEPI/');await login();await navigate('biometria');assert.equal(requests.length,0);
    await page.locator('#bioOpenTestButton').click();assert.equal(requests.length,0);assert.equal(await page.locator('#bioCaptureWorker').innerText(),'Nenhum trabalhador vinculado');
    passed('biometria não consulta nem captura automaticamente ao navegar ou abrir o painel');
    await page.locator('#bioCaptureButton').click();await captured();assert.equal(registrations.length,0);assert.equal(await page.locator('#bioRegisterButton').isVisible(),false);await noStoredBiometrics();
    assert.ok(!(await page.locator('#bioOutput').innerText()).includes('TEMPLATE'));assert.ok(!(await page.locator('#bioOutput').innerText()).includes('NAO-EXIBIR-LOG'));
    await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
    await page.screenshot({path:path.join(output,'biometria-captura-teste-desktop.png'),fullPage:true});
    await page.locator('#bioCancelButton').click();await discarded();
    passed('captura de teste decodifica imagem real retornada pelo contrato e descarta sem salvar');

    statusMode='wrong';await page.locator('#bioTestButton').click();await page.waitForFunction(()=>document.getElementById('bioStatusBadge').dataset.state==='error');assert.ok(!(await page.locator('#bioOutput').innerText()).includes('TEMPLATE'));
    statusMode='missing';await page.locator('#bioTestButton').click();await page.waitForFunction(()=>document.getElementById('bioStatusBadge').dataset.state==='warning');
    passed('HTTP 200 incompatível e agente sem leitor nunca são apresentados como prontos');

    statusMode='alternative';captureMode='fallback';const beforeFallback=requests.length;await page.locator('#bioOpenTestButton').click();await page.locator('#bioCaptureButton').click();await captured();
    const fallback=requests.slice(beforeFallback).filter(item=>item.path.includes('capture'));assert.deepEqual(fallback.map(item=>[item.port,item.path]),[[8790,'/api/capture'],[8790,'/capture']]);await page.locator('#bioCancelButton').click();await discarded();
    passed('porta alternativa e fallback de rota 404 funcionam sem tokens ou dados do trabalhador');

    statusMode='ready';captureMode='invalid';await page.locator('#bioOpenTestButton').click();await page.locator('#bioCaptureButton').click();await page.waitForFunction(()=>document.getElementById('bioCaptureResult').classList.contains('error'));assert.equal(await page.locator('#bioCaptureImage').isVisible(),false);assert.equal(registrations.length,0);await page.locator('#bioCancelButton').click();
    passed('bytes com cabeçalho PNG e conteúdo inválido são rejeitados pela decodificação do navegador');

    captureMode='ready';await navigate('fichas');await page.locator('[data-capture-ficha-id="BIO-FICHA-0"]').click();assert.match(await page.locator('#bioCaptureCompany').innerText(),/ALFA/);assert.match(await page.locator('#bioCaptureWorker').innerText(),/ALFA/);assert.equal(await page.locator('#bioCaptureFicha').innerText(),'EPI-BIO-SINTÉTICA-0');
    await page.locator('#bioFingerSelect').selectOption('L_INDEX');await page.locator('#bioCaptureButton').click();await captured();
    await page.locator('#bioRegisterButton').click();await page.waitForFunction(()=>document.getElementById('bioRegisterButton').textContent==='Tentar registrar novamente');assert.equal(commitCount,1);assert.equal(await page.locator('#bioCaptureButton').isDisabled(),true);
    await page.locator('#bioRegisterButton').click();await page.waitForFunction(()=>document.getElementById('appMessage').classList.contains('success'));await discarded();assert.equal(registrations.length,2);assert.deepEqual(registrations[0],registrations[1]);assert.equal(commitCount,1);assert.equal(registrations[0].fingerCode,'L_INDEX');assert.equal(await page.locator('[data-capture-ficha-id="BIO-FICHA-0"]').count(),0);
    passed('registro associa empresa/trabalhador/ficha e repete o mesmo UUID após perda de resposta sem duplicar');

    const html=await page.evaluate(({ficha,company,worker,equipment})=>window.JP_FICHA.buildDocument(ficha,company,worker,[equipment]),{ficha:fichas[0],company:companies[0],worker:workers[0],equipment});assert.ok(html.includes('Assinatura registrada'));assert.ok(!html.includes('Assinado Biometricamente'));assert.equal((html.match(/Imagem da captura biométrica registrada/g)||[]).length,1);
    const printPage=await context.newPage();await printPage.setContent(html);await printPage.evaluate(async()=>{await Promise.all([...document.images].map(image=>image.decode()));});const pdf=path.join(output,'biometria-ficha-captura-sintetica.pdf');await printPage.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});await printPage.close();
    const printed=execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});assert.ok(printed.includes('TERMO DE RESPONSABILIDADE'));assert.ok(printed.includes('000ABC123'));assert.match(printed,/Assinatura\s+registrada/);assert.ok(!printed.includes('Assinado Biometricamente'));
    passed('ficha impressa mantém termo, matrícula e imagem única sem alegar identidade verificada');

    await startHeld('BIO-FICHA-1');await page.locator('#bioCancelButton').click();await discarded();releaseCapture();await page.waitForTimeout(50);assert.equal(await page.locator('#bioCaptureImage').getAttribute('src'),null);assert.equal(registrations.length,2);
    passed('cancelamento durante captura descarta a resposta tardia e não registra a ficha');

    await startHeld('BIO-FICHA-1');await page.locator('#empresaAtivaSelect').selectOption('BIO-EMPRESA-B');await page.waitForFunction(()=>document.getElementById('metricFichas').textContent==='1');await discarded();releaseCapture();await page.waitForTimeout(50);assert.equal(await page.locator('#bioCaptureImage').getAttribute('src'),null);assert.equal(registrations.length,2);
    passed('troca de empresa cancela a captura e impede associar a imagem ao novo contexto');

    await startHeld('BIO-FICHA-2');await page.locator('#logoutButton').click();await page.locator('#loginPage').waitFor({state:'visible'});await discarded();releaseCapture();await page.waitForTimeout(50);assert.equal(registrations.length,2);
    passed('logout cancela captura e remove imagem, seleção e estado da confirmação');

    captureMode='ready';await page.setViewportSize({width:390,height:844});await login();await navigate('biometria');await page.locator('#bioOpenTestButton').click();await page.locator('#bioCaptureButton').click();await captured();
    const width=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,panel:document.getElementById('bioCapturePanel').getBoundingClientRect().width}));assert.ok(width.body<=width.viewport+1);assert.ok(width.panel<=width.viewport);await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});await page.screenshot({path:path.join(output,'biometria-captura-teste-mobile.png'),fullPage:true});await page.locator('#bioCancelButton').click();await discarded();
    passed('captura e comandos cabem na tela de celular sem rolagem horizontal');
    assert.deepEqual(errors,[]);report.passed=true;report.registerRequests=registrations.length;report.committedCaptures=commitCount;return report;
  }catch(error){report.error=error.message;await page.screenshot({path:path.join(output,'biometria-browser-falha.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{if(releaseCapture)releaseCapture();fs.writeFileSync(path.join(output,'biometria-browser-results.json'),JSON.stringify(report,null,2)+'\n');await context.close();}
};
