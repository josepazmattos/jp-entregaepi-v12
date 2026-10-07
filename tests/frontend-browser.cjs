// Executa a interface publicada em um servidor HTTP local, com APIs simuladas.
// Todos os nomes, documentos, equipamentos, tokens e imagens são sintéticos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const frontend = path.resolve(__dirname, '../frontend/EntregaEPI');
const output = path.join(__dirname, 'output');
fs.mkdirSync(output,{recursive:true});
const results={suite:'Interface e impressão V12.8.0',syntheticData:true,realApiUsed:false,checks:[],pdfs:{},layouts:{}};
const company={id:'EMPRESA-TESTE',nome:'EMPRESA EXEMPLO',cnpj:'00.000.000/0000-00',localidade:'Cidade de Teste',uf:'MS'};
const worker={id:'TRABALHADOR-TESTE',empresaId:company.id,nomeCompleto:'TRABALHADOR DE TESTE',cpf:'000.000.000-00',funcao:'FUNÇÃO DE TESTE',matriculaESocial:'00042',status:'Ativo'};
const epi={id:'EPI-TESTE',empresaId:company.id,descricao:'EQUIPAMENTO DE TESTE',ca:'00000',fabricante:'FABRICANTE DE TESTE'};
const initialFicha={id:'FICHA-TESTE',numero:'EPI-TESTE-0001',empresaId:company.id,trabalhadorId:worker.id,trabalhadorNome:worker.nomeCompleto,tipo:'Entrega',data:'06/10/2026',status:'pendente',itens:[{epiId:epi.id,epiDescricao:epi.descricao,ca:epi.ca,quantidade:1}]};
const database={empresas:[company],trabalhadores:[worker],epis:[epi],fichas:[initialFicha]};
const requests=[];
const pageErrors=[];
const printEvents=[];
const printListeners=new Set();
const imageRequests=[],imageResponses=[],failedRequests=[],consoleMessages=[],serverRequests=[];
Object.assign(results,{printEvents,imageRequests,imageResponses,failedRequests,consoleMessages,serverRequests});
let apiFailure=0;
let biometricRequests=0;
let browser;
let page;
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken=`${encode({alg:'RS256',typ:'JWT'})}.${encode({sub:'USUARIO-SINTETICO','cognito:username':'USUARIO-TESTE','cognito:groups':['MASTER'],exp:4102444800})}.ASSINATURA_DE_TOKEN_SINTETICA`;
const server=http.createServer((req,res)=>{
  serverRequests.push({url:req.url,method:req.method});
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/EntregaEPI\/?/,'');
  const file=path.resolve(frontend,relative||'index.html');
  if(!file.startsWith(frontend+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Não encontrado');return;}
  const ext=path.extname(file);
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[ext]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');
  const contents=fs.readFileSync(file);
  res.end(ext==='.html'?contents.toString().replaceAll('__APP_PREFIX__','EntregaEPI'):contents);
});

function passed(name){results.checks.push({name,passed:true});console.log(`PASSOU: ${name}`);}
function pdfPages(file){const matches=fs.readFileSync(file).toString('latin1').match(/\/Type\s*\/Page\b/g);return matches?.length||0;}
function diagnosticWithTimeout(promise,milliseconds){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Tempo limite ao gerar evidência visual.')),milliseconds)})]).finally(()=>clearTimeout(timer));
}

async function inspectLayout(name){
  const dimensions=await page.evaluate(()=>({
    viewport:{width:window.innerWidth,height:window.innerHeight},
    documentWidth:document.documentElement.scrollWidth,
    bodyWidth:document.body.scrollWidth,
    outsideViewport:Array.from(document.querySelectorAll('body *')).filter(element=>{
      const bounds=element.getBoundingClientRect();
      return bounds.width>0&&bounds.height>0&&(bounds.right>window.innerWidth+1||bounds.left< -1);
    }).slice(0,12).map(element=>({tag:element.tagName,id:element.id,className:typeof element.className==='string'?element.className:''}))
  }));
  results.layouts[name]=dimensions;
  assert.ok(dimensions.documentWidth<=dimensions.viewport.width+1,`${name}: documento sem rolagem horizontal global (${dimensions.documentWidth}px)`);
  assert.ok(dimensions.bodyWidth<=dimensions.viewport.width+1,`${name}: conteúdo cabe na largura disponível (${dimensions.bodyWidth}px)`);
  await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});
}

async function assertDiagnosticsClosed(screen){
  const details=page.locator(`#screen-${screen} details`);
  assert.ok(await details.count()>0,`${screen}: dados técnicos têm um controle de expansão`);
  assert.equal(await details.evaluateAll(items=>items.every(item=>!item.open)),true,`${screen}: diagnósticos fechados por padrão`);
  const rawIds=screen==='config'?['apiOutput','configOutput']:['bioOutput'];
  for(const id of rawIds){
    assert.equal(await page.locator('#'+id).isVisible(),false,`${id}: resposta técnica não ocupa a tela principal`);
    assert.equal(await page.locator('#'+id).evaluate(item=>Boolean(item.closest('details'))),true,`${id}: dados técnicos podem ser expandidos`);
  }
}

async function assertMenuClosed(){
  await page.waitForFunction(()=>document.getElementById('menuToggle').getAttribute('aria-expanded')==='false');
  assert.equal(await page.locator('#appShell').evaluate(element=>element.classList.contains('sidebar-open')),false);
  await page.locator('#primarySidebar').waitFor({state:'hidden'});
}

async function mobileNavigate(screen){
  await page.locator('#menuToggle').click();
  await page.waitForFunction(()=>document.getElementById('menuToggle').getAttribute('aria-expanded')==='true');
  const navigation=page.locator(`.nav [data-screen="${screen}"]`);
  await navigation.waitFor({state:'visible'});
  assert.equal(await navigation.isVisible(),true);
  await navigation.click();
  await assertMenuClosed();
  assert.equal(await page.locator(`#screen-${screen}`).isVisible(),true);
}

function waitForPrintCall(afterIndex){
  const recorded=printEvents.slice(afterIndex).find(event=>event.kind==='print_called');
  if(recorded)return Promise.resolve(recorded);
  return new Promise((resolve,reject)=>{
    const listener=event=>{
      if(event.kind!=='print_called')return;
      clearTimeout(timer);printListeners.delete(listener);resolve(event);
    };
    const timer=setTimeout(()=>{printListeners.delete(listener);reject(new Error('A chamada automática a window.print não foi observada após carregar a ficha.'));},10000);
    printListeners.add(listener);
  });
}

async function printAndInspect(context,record,prefix,{expectedPages=1}={}){
  const printStart=printEvents.length;
  const popupPromise=context.waitForEvent('page');
  await page.locator(`button[data-ficha-id="${record.id}"]`).click();
  const popup=await popupPromise;
  try{
    await popup.waitForSelector('.docx-epi-table');
    await popup.waitForFunction(()=>Array.from(document.images).every(img=>img.complete&&img.naturalWidth>0),null,{timeout:10000});
    const invocation=await waitForPrintCall(printStart);
    assert.equal(invocation.title,await popup.title(),'window.print pertence à ficha aberta');
  const geometry=await popup.evaluate(()=>{
    const metadata=document.querySelector('.docx-meta').getBoundingClientRect();
    const term=document.querySelector('.docx-term-title').getBoundingClientRect();
    const signature=document.querySelector('.docx-sign-area').getBoundingClientRect();
    const table=document.querySelector('.docx-epi-table').getBoundingClientRect();
    const sheet=document.querySelector('.sheet').getBoundingClientRect();
    return {metadataBottom:metadata.bottom,termTop:term.top,signatureBottom:signature.bottom,tableTop:table.top,tableRight:table.right,sheetRight:sheet.right,
      name:document.querySelector('.docx-worker-name').textContent,termText:document.querySelector('.docx-term').textContent,
      font:getComputedStyle(document.querySelector('.sheet')).fontFamily,
      rows:document.querySelectorAll('.docx-epi-table tbody tr').length,
      overflowingCells:Array.from(document.querySelectorAll('td,th')).filter(cell=>cell.scrollWidth>cell.clientWidth+1).length};
  });
  assert.ok(geometry.metadataBottom<=geometry.termTop,'identificação antes do termo');
  assert.ok(geometry.signatureBottom<=geometry.tableTop+1,'termo e assinatura antes dos EPIs');
  assert.ok(geometry.tableRight<=geometry.sheetRight+1,'tabela cabe na largura da ficha');
  assert.equal(geometry.overflowingCells,0,'texto não ultrapassa as células');
  assert.ok(geometry.font.includes('Times New Roman'));
  assert.ok(geometry.termText.includes('súmula n. 80 do TST.'));
  assert.equal(geometry.rows,record.itens.length);
  assert.equal(geometry.name,worker.nomeCompleto);
  await popup.emulateMedia({media:'print'});
  const pdf=path.join(output,`${prefix}.pdf`);
  await popup.pdf({path:pdf,format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
  const pages=pdfPages(pdf);
  results.pdfs[prefix]={pages,rows:geometry.rows,font:geometry.font};
  if(expectedPages!==null)assert.equal(pages,expectedPages,`${prefix}: quantidade de páginas`);
  else assert.ok(pages>1,'ficha longa deve paginar sem perder os itens');
  if(expectedPages!==null)await popup.screenshot({path:path.join(output,`${prefix}.png`),fullPage:true});
  const bodyText=await popup.locator('body').innerText();
  await popup.close();
  return bodyText;
  }catch(error){
    // Captura evidência para qualquer falha após abrir a ficha, incluindo imagens.
    results.printFailure=await popup.evaluate(async()=>{
      const describeSource=value=>value&&value.length>220?value.slice(0,160)+`... (${value.length} caracteres)`:value;
      return {url:document.URL,baseURI:document.baseURI,origin:window.origin,readyState:document.readyState,visibilityState:document.visibilityState,fontStatus:document.fonts?.status,printFunction:String(window.print).slice(0,200),
        images:await Promise.all(Array.from(document.images).map(async(img,index)=>{
          const decode=await Promise.race([img.decode().then(()=>({ok:true}),error=>({ok:false,error:error.message})),new Promise(resolve=>setTimeout(()=>resolve({pending:true}),1000))]);
          return {index,src:describeSource(img.getAttribute('src')),currentSrc:describeSource(img.currentSrc),complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,decode};
        }))};
    }).catch(()=>({}));
    await popup.emulateMedia({media:'print'}).catch(()=>{});
    await diagnosticWithTimeout(popup.pdf({path:path.join(output,`${prefix}-falha.pdf`),format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false}),10000).catch(pdfError=>{results.diagnosticPdfError=pdfError.message});
    try{
      await popup.screenshot({path:path.join(output,`${prefix}-falha.png`),fullPage:true,timeout:10000});
    }catch(screenshotError){
      results.diagnosticScreenshotError=screenshotError.message;
      const session=await context.newCDPSession(popup).catch(()=>null);
      if(session){
        const capture=await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}).catch(()=>null);
        if(capture)fs.writeFileSync(path.join(output,`${prefix}-falha.png`),Buffer.from(capture.data,'base64'));
        await session.detach();
      }
    }
    throw error;
  }
}

async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  results.browser=await browser.version();
  const context=await browser.newContext({viewport:{width:1366,height:900},locale:'pt-BR',timezoneId:'America/Campo_Grande'});
  context.on('page',newPage=>newPage.on('pageerror',error=>pageErrors.push(error.message)));
  context.on('console',message=>{if(['error','warning'].includes(message.type()))consoleMessages.push({type:message.type(),text:message.text(),location:message.location()})});
  context.on('request',request=>{
    if(request.resourceType()!=='image')return;
    const headers=request.headers();
    imageRequests.push({url:request.url(),referer:headers.referer||'',origin:headers.origin||'',fetchSite:headers['sec-fetch-site']||''});
  });
  context.on('response',response=>{if(response.request().resourceType()==='image')imageResponses.push({url:response.url(),status:response.status(),contentType:response.headers()['content-type']||''})});
  context.on('requestfailed',request=>failedRequests.push({url:request.url(),resourceType:request.resourceType(),failure:request.failure()}));
  await context.exposeBinding('__jpPrintObserved',(_source,event)=>{
    printEvents.push(event);
    for(const listener of printListeners)listener(event);
  });
  // Executa em cada documento navegado, inclusive a ficha Blob, e observa a
  // chamada original a print sem substituir sua execução por um marcador local.
  await context.addInitScript(()=>{
    const nativePrint=window.print.bind(window);
    const report=kind=>{
      if(typeof window.__jpPrintObserved==="function")window.__jpPrintObserved({kind,title:document.title}).catch(()=>{});
    };
    window.addEventListener('beforeprint',()=>report('beforeprint'));
    window.print=()=>{report('print_called');return nativePrint();};
  });
  // Recursos locais são servidos por HTTP, sem interceptação; todas as externas continuam simuladas ou bloqueadas.
  results.localAssetsIntercepted=false;
  await context.route(url=>url.origin!==origin,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin){await route.continue();return;}
    const json=async(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(url.hostname.startsWith('cognito-idp.')&&url.hostname.endsWith('.amazonaws.com')){
      const body=request.postDataJSON();
      assert.equal(body.AuthParameters.USERNAME,'USUARIO-TESTE');
      await json(200,{AuthenticationResult:{IdToken:idToken,AccessToken:'ACCESS_TOKEN_SINTETICO',ExpiresIn:3600}});return;
    }
    if(url.origin==='http://127.0.0.1:8789'&&url.pathname==='/status'){
      biometricRequests++;
      await json(200,{ok:true,service:'SERVICO-BIOMETRICO-SINTETICO'});return;
    }
    if(!url.hostname.endsWith('.execute-api.sa-east-1.amazonaws.com')){
      results.unexpectedExternalRequest=true;
      await route.abort();return;
    }
    requests.push({path:url.pathname,method:request.method(),authorizationPresent:request.headers().authorization===`Bearer ${idToken}`,empresaId:request.headers()['x-empresa-id']});
    if(apiFailure){await json(apiFailure,{ok:false,error:apiFailure===403?'Perfil não configurado. Solicite ao administrador.':'Sessão expirada.'});return;}
    if(url.pathname==='/health'){
      await json(200,{ok:true,version:'12.8.0',mode:'dynamodb',durable:true,storageReady:true,buildSha:'BUILD-SINTETICO',caepi:{sourceKind:'official-snapshot',officialSnapshot:true,live:false,downloadedAt:'2026-10-06T16:00:00Z'}});return;
    }
    if(url.pathname.startsWith('/api/caepi/')){
      if(url.pathname.endsWith('/654321')){
        await json(200,{ok:true,item:{found:false,ambiguous:true,autofillAllowed:false,officialSnapshot:true,live:false,requiresOfficialConfirmation:true,name:'',description:'',manufacturer:'',validity:'',warning:'Registros divergentes para este CA. Confirme no portal do MTE. <strong>Mensagem sintética</strong>'}});return;
      }
      if(url.pathname.endsWith('/789001')){
        await json(200,{ok:true,item:{found:true,name:'EPI SINTÉTICO COMPLEMENTAR',description:'EPI SINTÉTICO COMPLEMENTAR',ca:'789001',status:'Conferência necessária',verified:false,live:false,requiresOfficialCheck:true}});return;
      }
      await json(200,{ok:true,item:{found:true,name:'EPI SINTÉTICO DE CONSULTA',description:'EPI SINTÉTICO DE CONSULTA',ca:'123456',status:'Válido na base consultada',officialSnapshot:true,verified:false,live:false,requiresOfficialCheck:true,downloadedAt:'2026-10-06T16:00:00Z',sourceUpdatedAt:null,warning:'Base oficial do MTE obtida em 06/10/2026; confirme atualizações no portal.'}});return;
    }
    if(request.headers().authorization!==`Bearer ${idToken}`){await json(401,{ok:false,error:'Não autenticado'});return;}
    const collection=url.pathname.replace(/^\/api\//,'');
    if(request.method()==='GET'&&Object.hasOwn(database,collection)){await json(200,{ok:true,items:database[collection]});return;}
    if(request.method()==='POST'&&collection==='fichas'){
      const body=request.postDataJSON();
      assert.equal(body.trabalhadorSnapshot.matriculaESocial,'00042');
      assert.equal(body.trabalhadorSnapshot.funcao,worker.funcao);
      assert.ok(body.modeloFicha.termoResponsabilidade.includes('súmula n. 80 do TST.'));
      const record={...body,id:'FICHA-NOVA-TESTE',numero:'EPI-TESTE-0002',status:'pendente'};
      database.fichas.push(record);await json(200,{ok:true,item:record});return;
    }
    await json(404,{ok:false,error:'Rota não prevista no teste'});
  });
  page=await context.newPage();
  await page.goto(`${origin}/EntregaEPI/`);
  await inspectLayout('desktop-login');
  await page.locator('#username').fill('USUARIO-TESTE');
  await page.locator('#password').fill('SENHA-SINTETICA-SEM-VALIDADE');
  await page.locator('#loginButton').click();
  await page.waitForFunction(()=>document.getElementById('metricFichas').textContent==='1');
  for(const id of ['metricEmpresas','metricTrabalhadores','metricEpis','metricFichas'])assert.equal(await page.locator('#'+id).innerText(),'1');
  assert.equal(requests.length,4,'dashboard consulta os quatro cadastros, sem diagnóstico CA automático');
  assert.ok(requests.every(request=>request.authorizationPresent));
  assert.ok(requests.filter(request=>request.path!=='/api/empresas').every(request=>request.empresaId===company.id));
  assert.equal(await page.locator('#appMessage').isVisible(),false);
  await page.screenshot({path:path.join(output,'dashboard.png'),fullPage:true});
  passed('login Cognito simulado e dashboard operacional sem erro');
  await inspectLayout('desktop-dashboard');

  await page.locator('[data-screen="epis"]').click();
  await page.locator('#caInput').fill('123456');
  await page.locator('button[onclick="consultarCA()"]').click();
  await page.waitForFunction(()=>document.getElementById('epiDescricao').value==='EPI SINTÉTICO DE CONSULTA');
  assert.equal(await page.locator('#caMessage').innerText(),'Base oficial do MTE obtida em 06/10/2026; confirme atualizações no portal.');
  passed('consulta à base oficial informa a obtenção da base e não alega consulta ao vivo');
  await page.locator('#caInput').fill('654321');
  await page.locator('button[onclick="consultarCA()"]').click();
  await page.waitForFunction(()=>document.getElementById('caMessage').textContent.includes('Registros divergentes'));
  for(const id of ['epiDescricao','epiFabricante','epiValidade','epiSituacao'])assert.equal(await page.locator('#'+id).inputValue(),'');
  assert.equal(await page.locator('#caMessage strong').count(),0,'mensagem recebida é texto e não HTML');
  assert.ok((await page.locator('#caMessage').innerText()).includes('<strong>Mensagem sintética</strong>'));
  assert.ok(!(await page.locator('#caMessage').innerText()).includes('não localizado'));
  passed('CA com registros divergentes não preenche dados e mantém aviso como texto seguro');
  await page.locator('#caInput').fill('789001');
  await page.locator('button[onclick="consultarCA()"]').click();
  await page.waitForFunction(()=>document.getElementById('epiDescricao').value==='EPI SINTÉTICO COMPLEMENTAR');
  assert.ok((await page.locator('#caMessage').innerText()).includes('sem confirmação atual no MTE'));
  passed('fallback complementar continua identificado sem confirmação atual no MTE');

  await page.locator('[data-screen="entrega"]').click();
  await page.locator('#entregaTrabalhador').selectOption(worker.id);
  await page.locator('#entregaEpi').selectOption(epi.id);
  await page.locator('#entregaForm input[name="quantidade"]').fill('2');
  await page.locator('#entregaForm button[type="submit"]').click();
  await page.waitForSelector('button[data-ficha-id="FICHA-NOVA-TESTE"]');
  assert.ok(await page.locator('#screen-fichas').evaluate(element=>element.classList.contains('active')));
  const created=database.fichas.find(record=>record.id==='FICHA-NOVA-TESTE');
  assert.equal(created.itens[0].quantidade,2);
  const pendingText=await printAndInspect(context,created,'ficha-pendente');
  for(const value of ['Nome do Trabalhador:','Função:','Matrícula eSocial:','00042','Tipo da movimentação:'])assert.ok(pendingText.includes(value));
  assert.ok(!pendingText.includes('Assinado Biometricamente'));
  passed('emissão, abertura da ficha e PDF A4 pendente com modelo completo');

  const syntheticImage=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=220;canvas.height=270;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,220,270);ctx.strokeStyle='#444';ctx.strokeRect(4,4,212,262);
    ctx.fillStyle='#333';ctx.font='bold 24px Arial';ctx.textAlign='center';
    for(const [line,y] of [['AMOSTRA',95],['SINTÉTICA',133],['SEM VALIDADE',173]])ctx.fillText(line,110,y);
    return canvas.toDataURL('image/png');
  });
  const capture={...created,id:'FICHA-CAPTURA-TESTE',numero:'EPI-TESTE-CAPTURA',itens:Array.from({length:4},(_,i)=>({...created.itens[0],epiDescricao:`EQUIPAMENTO DE TESTE ${i+1}`})),assinaturaBiometrica:{realFingerImage:syntheticImage,verificada:false,metodo:'captura_de_imagem',dedo:'L_THUMB',quality:80,id:'CAPTURA-SINTETICA',signedAt:'2026-10-06T16:00:00Z'}};
  const longRecord={...created,id:'FICHA-LONGA-TESTE',numero:'EPI-TESTE-60-ITENS',itens:Array.from({length:60},(_,i)=>({...created.itens[0],epiDescricao:`EQUIPAMENTO SINTÉTICO ITEM ${String(i+1).padStart(3,'0')} - DESCRIÇÃO PARA CONFERÊNCIA DE PAGINAÇÃO`}))};
  database.fichas.push(capture,longRecord);
  await page.locator('#screen-fichas button').filter({hasText:'Atualizar fichas'}).click();
  await page.waitForSelector('button[data-ficha-id="FICHA-CAPTURA-TESTE"]');
  const capturedText=await printAndInspect(context,capture,'ficha-captura');
  assert.ok(capturedText.includes('Captura registrada; assinatura pendente de verificação.'));
  assert.ok(!capturedText.includes('Assinado Biometricamente'));
  passed('captura sintética tem aviso de assinatura pendente e não é validada por clique');
  const longText=await printAndInspect(context,longRecord,'ficha-longa',{expectedPages:null});
  assert.ok(longText.includes('ITEM 060'));
  passed('ficha com 60 EPIs preserva todos os itens e pagina em A4');

  await page.locator('.nav [data-screen="config"]').click();
  await assertDiagnosticsClosed('config');
  assert.ok((await page.locator('#configVersion').innerText()).includes('12.8.0'));
  assert.ok((await page.locator('#configCompany').innerText()).includes(company.nome));
  await inspectLayout('desktop-config');
  await page.locator('#healthTestButton').click();
  await page.waitForFunction(()=>document.getElementById('apiStatusBadge').dataset.state==='success');
  assert.ok((await page.locator('#apiStatusText').innerText()).length>0);
  await page.locator('#caTestButton').click();
  await page.waitForFunction(()=>['success','warning'].includes(document.getElementById('caStatusBadge').dataset.state));
  const caSummary=await page.locator('#caStatusText').innerText();
  assert.match(caSummary,/cópia oficial obtida/i);
  assert.match(caSummary,/atualizações.*portal do MTE/i);
  assert.ok(!/consulta ao vivo confirmada|atualiza[çc][aã]o em tempo real|conex[aã]o ao vivo confirmada/i.test(caSummary),'resumo do CA não apresenta uma cópia oficial como consulta ao vivo');
  await assertDiagnosticsClosed('config');
  passed('configuração mostra resumos de API e base CA com diagnóstico técnico fechado');

  await page.locator('.nav [data-screen="biometria"]').click();
  await assertDiagnosticsClosed('biometria');
  assert.equal(biometricRequests,0,'o serviço local só é consultado por ação do usuário');
  await page.locator('#bioTestButton').click();
  await page.waitForFunction(()=>document.getElementById('bioStatusBadge').dataset.state==='success');
  assert.equal(await page.locator('#bioStatusBadge').innerText(),'Serviço acessível');
  const bioSummary=(await page.locator('#bioStatusTitle').innerText())+' '+(await page.locator('#bioStatusText').innerText());
  assert.match(bioSummary,/não confirma .*detecção do leitor.*captura.*verificação.*assinatura biométrica/i);
  assert.ok(!/leitor detectado|assinatura (validada|confirmada)|biometria verificada/i.test(bioSummary));
  assert.equal(biometricRequests,1);
  await assertDiagnosticsClosed('biometria');
  await inspectLayout('desktop-biometria');
  passed('HTTP 200 do serviço biométrico informa acesso sem atribuir detecção ou verificação');
  passed('login, dashboard, configurações e biometria cabem em desktop de 1366 por 900');

  apiFailure=403;
  await page.locator('[data-screen="empresas"]').click();
  await page.locator('#empresaForm input[name="nome"]').fill('CADASTRO SINTÉTICO NÃO SALVO');
  await page.locator('#empresaCnpj').fill('00.000.000/0000-00');
  await page.locator('#empresaForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.getElementById('appMessage').textContent.includes('Perfil não configurado'));
  assert.equal(await page.locator('#empresaForm input[name="nome"]').inputValue(),'CADASTRO SINTÉTICO NÃO SALVO');
  assert.equal(await page.locator('#empresaForm button[type="submit"]').isDisabled(),false);
  await page.screenshot({path:path.join(output,'perfil-sem-permissao.png'),fullPage:true});
  passed('403 mantém o cadastro digitado e mostra orientação do perfil');

  apiFailure=401;
  await page.locator('[data-screen="dashboard"]').click();
  await page.locator('#refreshButton').click();
  await page.waitForSelector('#loginPage:not(.hidden)');
  assert.ok((await page.locator('#loginMessage').innerText()).includes('sessão expirou'));
  assert.equal(await page.locator('#password').inputValue(),'');
  passed('401 encerra sessão expirada sem reter a senha usada na autenticação');

  await page.setViewportSize({width:390,height:844});
  await inspectLayout('mobile-login');
  apiFailure=0;
  await page.locator('#password').fill('SENHA-SINTETICA-SEM-VALIDADE');
  await page.locator('#loginButton').click();
  await page.waitForFunction(count=>document.getElementById('metricFichas').textContent===String(count),database.fichas.length);
  await assertMenuClosed();
  await inspectLayout('mobile-dashboard');
  await page.locator('#menuToggle').click();
  await page.waitForFunction(()=>document.getElementById('menuToggle').getAttribute('aria-expanded')==='true');
  await page.locator('#sidebarClose').waitFor({state:'visible'});
  assert.equal(await page.locator('#sidebarClose').isVisible(),true);
  await page.locator('#sidebarClose').click();
  await assertMenuClosed();
  await page.locator('#menuToggle').click();
  await page.waitForFunction(()=>document.getElementById('menuToggle').getAttribute('aria-expanded')==='true');
  await page.keyboard.press('Escape');
  await assertMenuClosed();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'menuToggle','Escape devolve o foco ao controle do menu');
  await mobileNavigate('config');
  assert.match(await page.locator('#currentSectionLabel').innerText(),/Configurações/i);
  await assertDiagnosticsClosed('config');
  await inspectLayout('mobile-config');
  await mobileNavigate('biometria');
  assert.match(await page.locator('#currentSectionLabel').innerText(),/Biometria/i);
  await assertDiagnosticsClosed('biometria');
  await inspectLayout('mobile-biometria');
  passed('menu móvel abre, fecha pelo botão e Escape, e fecha após navegar');
  passed('login, dashboard, configurações e biometria cabem em celular de 390 por 844');
  assert.deepEqual(pageErrors,[],'nenhuma exceção JavaScript não tratada');
  assert.ok(!results.unexpectedExternalRequest,'nenhuma conexão a serviços reais');
  results.tenants=await require('./frontend-tenant-browser.cjs')({browser,origin,output});
  results.checks.push(...results.tenants.checks);
  results.passed=true;
}

main().catch(async error=>{
  results.passed=false;results.error=error.message;results.pageErrors=pageErrors;
  console.error(error.stack||error.message);
  if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'falha.png'),fullPage:true}).catch(()=>{});
  process.exitCode=1;
}).finally(async()=>{
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2)+'\n');
  if(browser)await browser.close();
  server.close();
});
