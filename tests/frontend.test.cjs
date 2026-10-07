// Testes de regressão com fixtures inteiramente sintéticas. Não usam a API real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const frontend = path.join(__dirname, '../frontend/EntregaEPI');
const index = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(frontend, 'assets/ficha.js'), 'utf8');
const biometricSource = fs.readFileSync(path.join(frontend, 'assets/biometria.js'), 'utf8');
const appSource = fs.readFileSync(path.join(frontend, 'assets/app.js'), 'utf8');
const moduleContext = vm.createContext({});
vm.runInContext(moduleSource, moduleContext);
const fichaModule = moduleContext.JP_FICHA;
const company = {id:'EMPRESA-TESTE',nome:'EMPRESA EXEMPLO',cnpj:'00.000.000/0000-00',localidade:'Cidade de Teste',uf:'MS'};
const worker = {id:'TRABALHADOR-TESTE',nomeCompleto:'TRABALHADOR DE TESTE',cpf:'000.000.000-00',funcao:'FUNÇÃO DE TESTE',matriculaESocial:'00042'};
const epi = {id:'EPI-TESTE',descricao:'EQUIPAMENTO DE TESTE',ca:'00000'};
const ficha = {id:'FICHA-TESTE',numero:'EPI-TESTE-0001',empresaId:company.id,trabalhadorId:worker.id,trabalhadorNome:worker.nomeCompleto,tipo:'Entrega',data:'2026-10-06',status:'pendente',itens:[{epiId:epi.id,epiDescricao:epi.descricao,ca:epi.ca,quantidade:2}]};
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function makeDocument(record=ficha, companyRecord=company, workerRecord=worker){return fichaModule.buildDocument(record,companyRecord,workerRecord,[epi],{defaultLogo:pixel});}

test('termo integral corresponde ao texto do modelo aprovado',()=>{
  const term=fichaModule.createSnapshot(company,worker).modeloFicha.termoResponsabilidade;
  assert.equal(createHash('sha256').update(term).digest('hex'),'ae8f8fced55857cade534b19ed96614ef2be2c2d5c009abfadef53c288d74f18');
});

test('ficha mantém identificação, termo e assinatura antes da relação dos EPIs',()=>{
  const html=makeDocument();
  for(const value of ['Nome do Trabalhador:','TRABALHADOR DE TESTE','Função:','FUNÇÃO DE TESTE','Matrícula eSocial:','00042','Tipo da movimentação:']) assert.ok(html.includes(value),value);
  const metadata=html.indexOf('<table class="docx-meta">');
  const term=html.indexOf('TERMO DE RESPONSABILIDADE');
  const sign=html.indexOf('<div class="docx-sign-area">');
  const items=html.indexOf('<table class="docx-epi-table"');
  assert.ok(metadata<term && term<sign && sign<items);
  assert.ok(html.includes('size:A4 portrait'));
  assert.ok(html.includes('Times New Roman'));
  assert.ok(html.includes('06/10/2026'));
  assert.equal((html.match(/<img /g)||[]).length,1,'somente o logo quando pendente');
});

test('snapshot preserva nome, função e matrícula da emissão após alteração de cadastro',()=>{
  const record={...ficha,...fichaModule.createSnapshot(company,worker)};
  const html=makeDocument(record,{...company,nome:'EMPRESA ALTERADA'},{...worker,nomeCompleto:'NOME ALTERADO',funcao:'FUNÇÃO ALTERADA',matriculaESocial:'99999'});
  assert.ok(html.includes('EMPRESA EXEMPLO'));
  assert.ok(html.includes('TRABALHADOR DE TESTE'));
  assert.ok(html.includes('FUNÇÃO DE TESTE'));
  assert.ok(html.includes('00042'));
  assert.ok(!html.includes('NOME ALTERADO'));
});

test('ficha legada com trabalhador removido mantém identificação gravada',()=>{
  const record={...ficha,job:'FUNÇÃO HISTÓRICA',esocial:'00037',cpf:'000.000.000-00'};
  const html=makeDocument(record,company,{});
  assert.ok(html.includes('TRABALHADOR DE TESTE'));
  assert.ok(html.includes('FUNÇÃO HISTÓRICA'));
  assert.ok(html.includes('00037'));
});

test('status assinado ou imagem recebida não provam validação biométrica',()=>{
  const legacy=makeDocument({...ficha,status:'assinada',assinaturaBiometrica:{realFingerImage:pixel,dedo:'L_THUMB'}});
  assert.ok(legacy.includes('Assinatura registrada'));
  assert.ok(legacy.includes('sem verificação biométrica disponível'));
  assert.ok(!legacy.includes('Assinado Biometricamente'));
  const captured=makeDocument({...ficha,assinaturaBiometrica:{realFingerImage:pixel,verificada:false,metodo:'captura_de_imagem'}});
  assert.ok(captured.includes('Captura registrada; assinatura pendente de verificação.'));
  assert.ok(!captured.includes('Assinado Biometricamente'));
});

test('comprovante verificado usa uma única imagem de captura e dados do comprovante',()=>{
  const html=makeDocument({...ficha,status:'assinada',assinaturaBiometrica:{realFingerImage:pixel,verificada:true,dedo:'L_THUMB',quality:0,id:'AUDITORIA-SINTETICA',signedAt:'2026-10-06T16:00:00Z'}});
  assert.ok(html.includes('Assinado Biometricamente'));
  assert.ok(html.includes('Polegar esquerdo'));
  assert.ok(html.includes('Qualidade 0'));
  assert.equal((html.match(/Imagem da captura biométrica registrada/g)||[]).length,1);
  assert.equal((html.match(/<img /g)||[]).length,2,'logo e captura única');
});

test('indicador legado realFingerImage não oculta a imagem armazenada no outro campo',()=>{
  const html=makeDocument({...ficha,status:'assinada',assinaturaBiometrica:{realFingerImage:true,fingerImageDataUrl:pixel,verificada:false,metodo:'captura_de_imagem'}});
  assert.equal((html.match(/<img /g)||[]).length,2,'logo e captura armazenada');
  assert.ok(html.includes('Assinatura registrada'));
  assert.ok(!html.includes('Assinado Biometricamente'));
});

test('devolução e datas de cada item não são substituídas pela data geral',()=>{
  const html=makeDocument({...ficha,itens:[{...ficha.itens[0],tipo:'Devolução',data:'2026-10-05',dataDevolucao:'2026-10-05'},{...ficha.itens[0],tipo:'Troca',data:'04/10/2026'}]});
  assert.ok(html.includes('Devolução</td><td>05/10/2026'));
  assert.ok(html.includes('05/10/2026</td></tr>'));
  assert.ok(html.includes('Troca</td><td>04/10/2026'));
});

test('cancelamento mantém a assinatura legada como registro e identifica a ficha cancelada',()=>{
  const html=makeDocument({...ficha,status:'cancelada',statusAnterior:'assinada',motivoCancelamento:'TESTE DE CANCELAMENTO',assinaturaBiometrica:{realFingerImage:pixel}});
  assert.ok(html.includes('FICHA CANCELADA - TESTE DE CANCELAMENTO'));
  assert.ok(html.includes('Assinatura registrada'));
  assert.ok(!html.includes('Captura registrada; assinatura pendente'));
  assert.ok(!html.includes('Assinado Biometricamente'));
});

test('campos de cadastro não podem inserir scripts ou imagens ativas no documento',()=>{
  const snapshot=fichaModule.createSnapshot({...company,logoDataUrl:'javascript:alert(1)'},{...worker,nomeCompleto:'<script>alert(1)</script>'});
  const html=makeDocument({...ficha,...snapshot,status:'assinada',assinaturaBiometrica:{realFingerImage:'data:image/svg+xml,<svg onload="alert(1)"></svg>',verificada:true}});
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('data:image/svg'));
  assert.ok(!html.includes('Assinado Biometricamente'));
});

test('ficha ausente, sem trabalhador e sem EPIs tem erro explícito',()=>{
  assert.throws(()=>makeDocument(null),/Ficha não encontrada/);
  assert.throws(()=>makeDocument({...ficha,trabalhadorNome:''},company,{}),/nome do trabalhador/);
  assert.throws(()=>makeDocument({...ficha,itens:[]}),/não possui EPIs/);
});

function element(id){
  const classNames=new Set();
  const attributes=new Map();
  const item={id,value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},listeners:{},children:[],
    classList:{add:(...names)=>names.forEach(name=>classNames.add(name)),remove:(...names)=>names.forEach(name=>classNames.delete(name)),contains:name=>classNames.has(name),
      toggle(name,force){const added=force===undefined?!classNames.has(name):Boolean(force);if(added)classNames.add(name);else classNames.delete(name);return added}},
    setAttribute(name,value){
      attributes.set(name,String(value));
      if(name==='class')this.className=String(value);
      if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);
    },
    getAttribute(name){return name==='class'?this.className:attributes.get(name)??null},
    hasAttribute(name){return attributes.has(name)},
    removeAttribute(name){attributes.delete(name);if(name==='class')classNames.clear()},
    addEventListener(event,listener){(this.listeners[event]||=[]).push(listener)},
    appendChild(child){this.children.push(child)},
    click(){for(const callback of this.listeners.click||[])callback({target:this,currentTarget:this,preventDefault(){}})},
    focus(){if(this.ownerDocument)this.ownerDocument.activeElement=this},
    reset(){this.resetCount=(this.resetCount||0)+1},querySelector(){return this.submitButton||={disabled:false}}
  };
  Object.defineProperty(item,'className',{get:()=>[...classNames].join(' '),set:value=>{classNames.clear();for(const name of String(value).split(/\s+/).filter(Boolean))classNames.add(name)}});
  return item;
}
function appHarness(route){
  const elements=Object.fromEntries([...index.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],element(match[1])]));
  const nav=[...index.matchAll(/<button[^>]*data-screen="([^"]+)"/g)].map(match=>{const button=element('nav-'+match[1]);button.dataset.screen=match[1];return button});
  const documentListeners={},windowListeners={};
  const document={getElementById:id=>elements[id]||null,createElement:tag=>element(tag),body:element('body'),activeElement:null,
    addEventListener(event,listener){(documentListeners[event]||=[]).push(listener)},
    querySelectorAll:selector=>selector==='.nav button'?nav:selector==='[data-master-only]'?[elements.empresaForm]:selector==='.screen'?Object.values(elements).filter(item=>item.id.startsWith('screen-')):[],
    querySelector:selector=>selector==='.brand-logo'?{src:pixel}:nav.find(item=>selector===`[data-screen="${item.dataset.screen}"]`)||null};
  for(const item of [...Object.values(elements),...nav,document.body])item.ownerDocument=document;
  for(const match of index.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    const item=elements[match[1]];
    for(const attribute of match[0].matchAll(/([\w:-]+)="([^"]*)"/g))item.setAttribute(attribute[1],attribute[2]);
  }
  const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)}};
  const requests=[];
  const context=vm.createContext({console,Date,JSON,Promise,Number,String,Array,Object,Error,RegExp,Boolean,decodeURIComponent,escape,
    atob:value=>Buffer.from(value,'base64').toString('binary'),localStorage:storage(),sessionStorage:storage(),alert:()=>{},setTimeout,clearTimeout,AbortController,URL,URLSearchParams,Uint8Array,crypto:require('node:crypto').webcrypto,
    addEventListener(event,listener){(windowListeners[event]||=[]).push(listener)},
    FormData:class {constructor(form){this.form=form}entries(){return Object.entries(this.form.fields||{})}},
    document,
    fetch:async(url,options={})=>{requests.push({url,options});const answer=await route(url,options);return {status:answer.status||200,ok:(answer.status||200)<400,text:async()=>JSON.stringify(answer.body),json:async()=>answer.body}}
  });
  context.window=context;
  context.JP_CONFIG={apiBaseUrl:'https://api.example.test',version:'12.8.1'};
  vm.runInContext(moduleSource,context);
  vm.runInContext(biometricSource,context);
  vm.runInContext(appSource,context);
  return {context,elements,requests,documentListeners,windowListeners,run:code=>vm.runInContext(code,context)};
}
const initialRoute=url=>({body:{ok:true,items:url.endsWith('/api/empresas')?[company]:url.endsWith('/api/trabalhadores')?[worker]:url.endsWith('/api/epis')?[epi]:url.endsWith('/api/fichas')?[ficha]:[]}});
function syntheticAuth(app,role='MASTER',username='CONTA-SINTETICA',empresaId=company.id){
  const payload={sub:username,'cognito:groups':[role],'custom:empresa_id':empresaId};
  const token='HEADER.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.ASSINATURA-SINTETICA';
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({username,idToken:token,expiresAt:Date.now()+60000,payload}));
  return token;
}

test('dashboard carrega sem os três indicadores técnicos removidos e sem consultar CA automaticamente',async()=>{
  const app=appHarness(initialRoute);
  await app.run('refreshAll()');
  for(const id of ['metricEmpresas','metricTrabalhadores','metricEpis','metricFichas']) assert.equal(app.elements[id].textContent,1,id);
  assert.ok(app.elements.dashboardFichas.innerHTML.includes('TRABALHADOR DE TESTE'));
  assert.ok(app.elements.nextActions.innerHTML.includes('Gere uma ficha de EPI'));
  assert.equal(app.requests.length,4);
  assert.ok(!app.requests.some(request=>/caepi|health/.test(request.url)));
});

test('ID token Cognito e empresa ativa continuam enviados no pedido da API',async()=>{
  const app=appHarness(initialRoute);
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({idToken:'TEST_ID_TOKEN',expiresAt:Date.now()+60000}));
  await app.run('refreshAll()');
  const request=app.requests.find(item=>item.url.endsWith('/api/trabalhadores'));
  assert.equal(request.options.headers.Authorization,'Bearer TEST_ID_TOKEN');
  assert.equal(request.options.headers['x-empresa-id'],company.id);
});

test('erro 403 é visível sem apagar senha ou converter resposta em cadastro vazio',async()=>{
  const app=appHarness(()=>({status:403,body:{ok:false,error:'Perfil não configurado. Solicite ao administrador.'}}));
  app.elements.password.value='SENHA-SINTETICA';
  await app.run('refreshAllSafe()');
  assert.ok(app.elements.appMessage.textContent.includes('Perfil não configurado'));
  assert.equal(app.elements.password.value,'SENHA-SINTETICA');
  assert.notEqual(app.elements.empresasList.textContent,'Nenhuma empresa cadastrada.');
});

test('erro 401 encerra apenas a sessão expirada e informa novo login',async()=>{
  const app=appHarness(()=>({status:401,body:{ok:false,error:'Não autenticado'}}));
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({idToken:'TEST_ID_TOKEN',expiresAt:Date.now()+60000}));
  app.elements.password.value='SENHA-SINTETICA';
  await app.run('refreshAllSafe()');
  assert.equal(app.context.sessionStorage.getItem('jp-v12-auth'),null);
  assert.ok(app.elements.loginMessage.textContent.includes('sessão expirou'));
  assert.equal(app.elements.password.value,'SENHA-SINTETICA');
});

test('logout limpa dados da sessão anterior antes de outro usuário entrar',async()=>{
  const app=appHarness(initialRoute);
  await app.run('refreshAll()');
  assert.ok(app.elements.dashboardFichas.innerHTML.includes('TRABALHADOR DE TESTE'));
  app.elements.password.value='SENHA-SINTETICA';
  app.elements.logoutButton.click();
  assert.equal(app.elements.dashboardFichas.textContent,'');
  assert.equal(app.elements.metricFichas.textContent,0);
  assert.equal(app.context.localStorage.getItem('jp-v12-active-company'),null);
  assert.equal(app.elements.trabalhadorForm.resetCount,1);
  assert.equal(app.elements.password.value,'');
});

test('troca de usuário após expiração elimina rascunhos da conta anterior',async()=>{
  const app=appHarness(initialRoute);
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({username:'CONTA-SINTETICA-ANTERIOR',idToken:'TEST_ID_TOKEN',expiresAt:Date.now()+60000}));
  await app.run('refreshAll()');
  app.run('showLogin()');
  assert.equal(app.elements.trabalhadorForm.resetCount,undefined,'rascunho mantido durante nova autenticação');
  app.run('saveAuth({IdToken:"NOVO_TOKEN_SINTETICO",ExpiresIn:3600},"OUTRA-CONTA-SINTETICA")');
  assert.equal(app.elements.trabalhadorForm.resetCount,1,'rascunho anterior não passa para outra conta');
  assert.equal(app.elements.dashboardFichas.textContent,'');
});

test('resposta iniciada antes do logout não repovoa dados da sessão encerrada',async()=>{
  let finish;
  const app=appHarness(()=>new Promise(resolve=>{finish=resolve}));
  const pending=app.run('refreshAllSafe()');
  app.elements.logoutButton.click();
  finish({body:{ok:true,items:[company]}});
  await pending;
  assert.equal(app.elements.empresasList.textContent,'');
  assert.equal(app.elements.metricEmpresas.textContent,0);
  assert.equal(app.context.localStorage.getItem('jp-v12-active-company'),null);
  assert.equal(app.elements.appMessage.textContent,'');
});

test('cadastro recusado preserva campos e permite nova tentativa',async()=>{
  const app=appHarness(()=>({status:403,body:{ok:false,error:'Perfil não configurado'}}));
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({username:'MASTER-SINTETICO',idToken:'TOKEN-SINTETICO',expiresAt:Date.now()+60000,payload:{'cognito:groups':['MASTER']}}));
  const form=app.elements.empresaForm;form.fields={nome:'CADASTRO SINTÉTICO'};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  assert.equal(form.resetCount,undefined);
  assert.equal(form.fields.nome,'CADASTRO SINTÉTICO');
  assert.equal(form.submitButton.disabled,false);
  assert.ok(app.elements.appMessage.textContent.includes('Perfil não configurado'));
});

test('emissão inclui snapshots e termo integral somente após validar trabalhador e EPI',async()=>{
  const app=appHarness((url,options)=>options.method==='POST'?{body:{ok:true,item:{id:'NOVA-FICHA-TESTE'}}}:initialRoute(url));
  await app.run('refreshAll()');
  const form=app.elements.entregaForm;form.fields={trabalhadorId:worker.id,epiId:epi.id,tipo:'Entrega',quantidade:'2'};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  const request=app.requests.find(item=>item.options.method==='POST');
  const sent=JSON.parse(request.options.body);
  assert.equal(sent.trabalhadorSnapshot.matriculaESocial,'00042');
  assert.equal(sent.trabalhadorSnapshot.funcao,'FUNÇÃO DE TESTE');
  assert.equal(sent.empresaSnapshot.nome,'EMPRESA EXEMPLO');
  assert.ok(sent.modeloFicha.termoResponsabilidade.includes('súmula n. 80 do TST.'));
  assert.equal(sent.itens[0].quantidade,2);
  assert.equal(form.submitButton.disabled,false);
});

test('quantidade inválida não envia nova ficha',async()=>{
  const app=appHarness(initialRoute);
  await app.run('refreshAll()');
  const form=app.elements.entregaForm;form.fields={trabalhadorId:worker.id,epiId:epi.id,tipo:'Entrega',quantidade:'0'};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  assert.ok(!app.requests.some(item=>item.options.method==='POST'));
  assert.ok(app.elements.appMessage.textContent.includes('quantidade inteira maior que zero'));
});

test('base CA complementar exibe aviso e consulta recusada limpa dados do CA anterior',async()=>{
  let fail=false;
  const app=appHarness(()=>fail?{status:404,body:{ok:false,error:'CA não localizado'}}:{body:{ok:true,item:{name:'EPI SINTÉTICO',status:'Conferência necessária',verified:false,live:false}}});
  app.elements.caInput.value='123456';
  await app.run('consultarCA()');
  assert.ok(app.elements.caMessage.textContent.includes('sem confirmação atual no MTE'));
  assert.equal(app.elements.epiDescricao.value,'EPI SINTÉTICO');
  fail=true;app.elements.caInput.value='987654';
  await app.run('consultarCA()');
  assert.equal(app.elements.epiDescricao.value,'');
  assert.ok(app.elements.caMessage.textContent.includes('CA não localizado'));
});

test('ausência de CA na base local não é apresentada como inexistência no MTE',async()=>{
  const app=appHarness(()=>({body:{ok:true,item:{found:false,warning:'A ausência nesta base local não comprova que o CA inexiste. Consulte o CAEPI/MTE.'}}}));
  app.elements.caInput.value='123456';app.elements.epiDescricao.value='EPI DE CONSULTA ANTERIOR';
  await app.run('consultarCA()');
  assert.equal(app.elements.epiDescricao.value,'');
  assert.ok(app.elements.caMessage.textContent.includes('não comprova que o CA inexiste'));
  assert.equal(app.elements.caMessage.className,'message warn');
});

test('base oficial informa a origem recebida e não é descrita como consulta ao vivo',async()=>{
  const warning='Base oficial do MTE obtida em 06/10/2026; confirme atualizações no portal.';
  const app=appHarness(()=>({body:{ok:true,item:{found:true,officialSnapshot:true,live:false,verified:false,downloadedAt:'2026-10-06T16:00:00Z',warning,name:'EPI SINTÉTICO OFICIAL',manufacturer:'FABRICANTE SINTÉTICO',validity:'31/12/2026',status:'Válido na base consultada'}}}));
  app.elements.caInput.value='123456';
  await app.run('consultarCA()');
  assert.equal(app.elements.epiDescricao.value,'EPI SINTÉTICO OFICIAL');
  assert.equal(app.elements.epiFabricante.value,'FABRICANTE SINTÉTICO');
  assert.equal(app.elements.epiValidade.value,'31/12/2026');
  assert.equal(app.elements.caMessage.textContent,warning);
  assert.equal(app.elements.caMessage.className,'message success');
  assert.ok(!app.elements.caMessage.textContent.includes('ao vivo'));
  assert.ok(!app.elements.caMessage.textContent.includes('complementar'));
});

test('base oficial sem mensagem pronta usa a data de obtenção, sem fabricar atualização da fonte',async()=>{
  const app=appHarness(()=>({body:{ok:true,item:{found:true,officialSnapshot:true,live:false,verified:false,downloadedAt:'2026-10-06',sourceUpdatedAt:null,name:'EPI SINTÉTICO OFICIAL'}}}));
  app.elements.caInput.value='123456';
  await app.run('consultarCA()');
  assert.equal(app.elements.caMessage.textContent,'Base oficial do MTE obtida em 06/10/2026; confirme atualizações no portal.');
});

test('CA ambíguo não preenche dados mesmo se vierem descrições na resposta',async()=>{
  const warning='Registros divergentes para este CA. Confirme no MTE. <strong>Mensagem de teste</strong>';
  const app=appHarness(()=>({body:{ok:true,item:{found:true,ambiguous:true,autofillAllowed:false,officialSnapshot:true,live:false,downloadedAt:'2026-10-06',name:'DESCRIÇÃO NÃO CONFIRMADA',manufacturer:'FABRICANTE NÃO CONFIRMADO',validity:'31/12/2026',warning}}}));
  app.elements.caInput.value='654321';
  for(const id of ['epiDescricao','epiFabricante','epiValidade','epiSituacao'])app.elements[id].value='CONSULTA ANTERIOR';
  await app.run('consultarCA()');
  for(const id of ['epiDescricao','epiFabricante','epiValidade','epiSituacao'])assert.equal(app.elements[id].value,'');
  assert.equal(app.elements.caMessage.textContent,warning);
  assert.equal(app.elements.caMessage.className,'message warn');
  assert.ok(!app.elements.caMessage.textContent.includes('não localizado'));
  assert.equal(app.elements.caMessage.innerHTML,'');
});

test('resumo da configuração usa versão, empresa e perfil da sessão carregada',async()=>{
  const app=appHarness(initialRoute);
  app.context.JP_CONFIG.ambiente='producao';
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({idToken:'TEST_ID_TOKEN',expiresAt:Date.now()+60000,payload:{'cognito:groups':['MASTER']}}));
  await app.run('refreshAll()');
  assert.equal(app.elements.configVersion.textContent,'12.8.1');
  assert.equal(app.elements.configEnvironment.textContent,'Produção');
  assert.equal(app.elements.configCompany.textContent,company.nome);
  assert.equal(app.elements.configProfile.textContent,'Master');
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({idToken:'TEST_ID_TOKEN',expiresAt:Date.now()+60000,payload:{}}));
  app.run('renderConfigSummary()');
  assert.equal(app.elements.configProfile.textContent,'Perfil não configurado','autenticação sem grupo não ganha perfil de administrador');
});

test('diagnóstico da API só apresenta operação pronta quando a persistência está confirmada',async()=>{
  let durable=false;
  const app=appHarness(()=>({body:{ok:true,version:'12.8.1',storageReady:true,durable}}));
  await app.run('testHealth()');
  assert.equal(app.elements.apiStatusBadge.dataset.state,'warning');
  assert.equal(app.elements.healthTestButton.disabled,false);
  durable=true;
  await app.run('testHealth()');
  assert.equal(app.elements.apiStatusBadge.dataset.state,'success');
});

test('resumo técnico de CA identifica a cópia oficial e a necessidade de conferir atualizações',async()=>{
  const app=appHarness(()=>({body:{ok:true,item:{found:true,officialSnapshot:true,live:false,downloadedAt:'2026-10-06T16:00:00Z',name:'EPI SINTÉTICO'}}}));
  await app.run('testCA()');
  assert.equal(app.elements.caStatusBadge.dataset.state,'success');
  assert.match(app.elements.caStatusText.textContent,/cópia oficial obtida/i);
  assert.match(app.elements.caStatusText.textContent,/atualizações.*portal do MTE/i);
  assert.equal(app.elements.caTestButton.disabled,false);
});

test('agente reconhecido informa leitor conectado sem afirmar identidade biométrica',async()=>{
  const app=appHarness(()=>({body:{ok:true,service:'JP Biometria Local Java',version:'12.8.1',capabilities:{capture:true,captureMethod:'POST',capturePath:'/api/capture'},sdk:true,reader:true,deviceCount:1,deviceName:'NITGEN HFDU06'}}));
  await app.run('testBiometriaLocal()');
  assert.equal(app.elements.bioStatusBadge.textContent,'Leitor conectado');
  assert.equal(app.elements.bioStatusBadge.dataset.state,'success');
  assert.match(app.elements.bioStatusText.textContent,/não confirma a identidade/i);
  assert.equal(app.elements.bioTestButton.disabled,false);
  assert.equal(app.requests.length,1);
  assert.equal(new URL(app.requests[0].url).origin,'http://127.0.0.1:8789');
  assert.equal(new URL(app.requests[0].url).pathname,'/status');
  assert.equal(app.requests[0].options.credentials,'omit');
  assert.equal(app.requests[0].options.headers,undefined);
});

test('erro HTTP do serviço biométrico não é apresentado como conexão confirmada',async()=>{
  const app=appHarness(()=>({status:503,body:{error:'ERRO-SINTETICO'}}));
  await app.run('testBiometriaLocal()');
  assert.equal(app.elements.bioStatusBadge.dataset.state,'error');
  assert.ok(!app.elements.bioStatusBadge.textContent.includes('acessível'));
  assert.equal(app.elements.bioTestButton.disabled,false);
});

test('consulta biométrica iniciada antes do logout não preenche o diagnóstico da sessão seguinte',async()=>{
  let finish;
  const app=appHarness(()=>new Promise(resolve=>{finish=resolve}));
  const pending=app.run('testBiometriaLocal()');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.elements.bioTestButton.disabled,true);
  app.elements.logoutButton.click();
  finish({body:{ok:true,service:'SERVICO-SINTETICO'}});
  await pending;
  assert.equal(app.elements.bioStatusBadge.dataset.state,'idle');
  assert.equal(app.elements.bioTestButton.disabled,false);
  assert.equal(app.elements.bioCheckedAt.textContent,'Nenhuma verificação nesta sessão.');
  assert.equal(app.elements.bioOutput.textContent,'Nenhuma verificação realizada nesta sessão.');
});

test('rejeição de rede após logout não restaura diagnósticos antigos de saúde ou CA',async()=>{
  for(const scenario of [
    {method:'testHealth',badge:'apiStatusBadge'},
    {method:'testCA',badge:'caStatusBadge'}
  ]){
    let rejectRequest;
    const app=appHarness(()=>new Promise((_resolve,reject)=>{rejectRequest=reject}));
    const pending=app.run(`${scenario.method}()`);
    assert.equal(app.elements[scenario.badge].dataset.state,'loading',scenario.method);
    app.elements.logoutButton.click();
    rejectRequest(new Error('FALHA-DE-REDE-SINTETICA'));
    await pending;
    assert.equal(app.elements[scenario.badge].dataset.state,'idle',scenario.method);
    assert.equal(app.elements.apiOutput.textContent,'Nenhuma verificação realizada nesta sessão.',scenario.method);
  }
});

test('empresa vê seu cadastro e não pode usar o formulário de criação reservado ao Master',async()=>{
  const app=appHarness(initialRoute);syntheticAuth(app,'EMPRESA');await app.run('refreshAll()');
  assert.equal(app.elements.empresaForm.classList.contains('hidden'),true);
  assert.equal(app.elements.empresaAtivaSelect.disabled,true);
  assert.equal(app.elements.companyShortcutTitle.textContent,'Minha empresa');
  const before=app.requests.length,form=app.elements.empresaForm;form.fields={nome:'EMPRESA NÃO AUTORIZADA'};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  assert.equal(app.requests.length,before,'não tenta criar uma empresa pelo formulário oculto');
  assert.match(app.elements.appMessage.textContent,/Master/);
});

test('Master recebe acesso inicial somente após confirmação de criação e não envia a senha no cadastro',async()=>{
  const created={...company,login:'login-sintetico',cnpj:'12.345.678/0000-00',acessoStatus:'ativo'};
  const app=appHarness((url,options)=>options.method==='POST'?{body:{ok:true,item:created,acesso:{login:created.login,status:'ativo',trocaObrigatoria:true}}}:initialRoute(url));
  syntheticAuth(app);const form=app.elements.empresaForm;form.fields={nome:created.nome,cnpj:created.cnpj,login:created.login};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  const request=app.requests.find(value=>value.options.method==='POST'),body=JSON.parse(request.options.body);
  assert.match(body.requestId,/^[a-f0-9-]{36}$/);
  assert.ok(!Object.keys(body).some(key=>/password|senha|secret/i.test(key)));
  assert.equal(app.elements.empresaCredentialsPanel.classList.contains('hidden'),false);
  assert.equal(app.elements.empresaCredentialsLogin.value,created.login);
  assert.equal(app.elements.empresaCredentialsPassword.value,'12345678');
  assert.ok(!app.context.sessionStorage.getItem('jp-v12-auth').includes('12345678'));
  app.elements.empresaCredentialsDismiss.click();
  assert.equal(app.elements.empresaCredentialsPassword.value,'');
  assert.equal(app.elements.empresaCredentialsPanel.classList.contains('hidden'),true);
});

test('provisionamento pendente não exibe senha como acesso pronto nem duplica formulário',async()=>{
  const created={...company,login:'login-sintetico',acessoStatus:'pendente'};
  const app=appHarness((url,options)=>options.method==='POST'?{status:202,body:{ok:true,item:created,acesso:{login:created.login,status:'pendente'},warning:'Empresa salva. Use Retomar acesso.'}}:{body:{ok:true,items:url.endsWith('/api/empresas')?[created]:[]}});
  syntheticAuth(app);const form=app.elements.empresaForm;form.fields={nome:created.nome,cnpj:'12.345.678/0000-00',login:created.login};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  assert.equal(app.elements.empresaCredentialsPassword.value,'');
  assert.equal(app.elements.empresaCredentialsPanel.classList.contains('hidden'),true);
  assert.match(app.elements.empresasList.innerHTML,/Retomar acesso/);
  assert.match(app.elements.appMessage.textContent,/Retomar acesso/);
  assert.equal(form.resetCount,1);
});

test('cadastro interrompido reaproveita a chave de idempotência na mesma tentativa',async()=>{
  const app=appHarness(()=>{throw new Error('FALHA DE REDE SINTÉTICA')});syntheticAuth(app);
  const form=app.elements.empresaForm;form.fields={nome:'EMPRESA SINTÉTICA',cnpj:'12.345.678/0000-00',login:'login-sintetico'};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  await form.listeners.submit[0]({preventDefault(){},target:form});
  assert.equal(app.requests.length,2);
  assert.equal(JSON.parse(app.requests[0].options.body).requestId,JSON.parse(app.requests[1].options.body).requestId);
  assert.equal(form.resetCount,undefined);
});

test('primeiro acesso limita a tentativa da senha inicial e guarda o desafio somente na memória',async()=>{
  let attempts=0;
  const app=appHarness((_url,options)=>{
    const body=JSON.parse(options.body);attempts++;
    if(attempts===1){assert.equal(body.AuthParameters.PASSWORD,'12345678');return {status:400,body:{__type:'NotAuthorizedException',message:'Falha sintética'}};}
    assert.equal(body.AuthParameters.PASSWORD,'JpEpi1-Inicial-12345678');
    return {body:{ChallengeName:'NEW_PASSWORD_REQUIRED',Session:'DESAFIO-SINTETICO',ChallengeParameters:{requiredAttributes:'[]',USER_ID_FOR_SRP:'conta-sintetica'}}};
  });
  app.elements.username.value='conta-sintetica';app.elements.password.value='12345678';
  await app.elements.loginForm.listeners.submit[0]({preventDefault(){}});
  assert.equal(attempts,2);assert.equal(app.elements.password.value,'');
  assert.equal(app.elements.newPasswordForm.classList.contains('hidden'),false);
  assert.equal(app.context.sessionStorage.getItem('jp-v12-auth'),null);
  assert.equal(app.run('Object.keys(firstAccessChallenge).sort().join(",")'),'cognitoUsername,session,username');
  app.elements.newPasswordCancel.click();
  assert.equal(app.run('firstAccessChallenge'),null);
  assert.equal(app.elements.newPasswordForm.classList.contains('hidden'),true);
});

test('falha de rede ou credencial definitiva não dispara tentativa extra de senha inicial',async()=>{
  for(const failure of ['network','definitive']){
    const app=appHarness(()=>{if(failure==='network')throw new Error('FALHA DE REDE SINTÉTICA');return {status:400,body:{__type:'NotAuthorizedException'}};});
    app.elements.username.value='conta-sintetica';app.elements.password.value=failure==='network'?'12345678':'Senha-Definitiva-Sintetica';
    await app.elements.loginForm.listeners.submit[0]({preventDefault(){}});
    assert.equal(app.requests.length,1,failure);
    assert.equal(app.context.sessionStorage.getItem('jp-v12-auth'),null);
  }
});

test('resposta de troca de senha cancelada não autentica uma sessão antiga',async()=>{
  let finish;
  const app=appHarness(()=>new Promise(resolve=>{finish=resolve}));
  app.run('beginFirstAccess({Session:"DESAFIO-SINTETICO",ChallengeParameters:{requiredAttributes:"[]"}},"conta-sintetica")');
  app.elements.newPassword.value='NovaSenhaSintetica8';app.elements.newPasswordConfirm.value='NovaSenhaSintetica8';
  const pending=app.elements.newPasswordForm.listeners.submit[0]({preventDefault(){}});
  app.elements.newPasswordCancel.click();finish({body:{AuthenticationResult:{IdToken:'TOKEN-SINTETICO',ExpiresIn:3600}}});await pending;
  assert.equal(app.context.sessionStorage.getItem('jp-v12-auth'),null);
  assert.equal(app.elements.newPassword.value,'');assert.equal(app.elements.newPasswordConfirm.value,'');
});

test('trabalhadores são exibidos e oferecidos para entrega em ordem alfabética',async()=>{
  const rows=[{...worker,id:'T3',nomeCompleto:'ZULMIRA SINTÉTICA'},{...worker,id:'T2',nomeCompleto:'bruno sintético'},{...worker,id:'T1',nomeCompleto:'ÁLVARO SINTÉTICO'}];
  const app=appHarness(url=>url.endsWith('/api/trabalhadores')?{body:{ok:true,items:rows}}:initialRoute(url));await app.run('refreshAll()');
  const list=app.elements.trabalhadoresList.innerHTML,options=app.elements.entregaTrabalhador.innerHTML;
  for(const html of [list,options])assert.ok(html.indexOf('ÁLVARO')<html.indexOf('bruno')&&html.indexOf('bruno')<html.indexOf('ZULMIRA'));
  app.elements.trabalhadorSearch.value='alvaro';app.run('renderTrabalhadores()');
  assert.ok(app.elements.trabalhadoresList.innerHTML.includes('ÁLVARO'));assert.ok(!app.elements.trabalhadoresList.innerHTML.includes('ZULMIRA'));
});

test('resposta da empresa anterior é descartada ao mudar de contexto',async()=>{
  let finish;
  const app=appHarness(()=>new Promise(resolve=>{finish=resolve}));syntheticAuth(app);app.run('saveActiveCompany("EMPRESA-ANTERIOR")');
  const pending=app.run('refreshTrabalhadores(false)');app.run('companyGeneration++;saveActiveCompany("EMPRESA-NOVA")');
  finish({body:{ok:true,items:[worker]}});
  await assert.rejects(pending,error=>error.code==='SESSION_CHANGED');
  assert.equal(app.run('cache.trabalhadores.length'),0);
  assert.equal(app.context.localStorage.getItem('jp-v12-active-company'),null);
  assert.equal(app.context.sessionStorage.getItem('jp-v12-active-company'),'EMPRESA-NOVA');
});

test('equipamento sem CA não exige empresa selecionada e limpa campos de certificação',async()=>{
  const app=appHarness((url,options)=>options.method==='POST'?{body:{ok:true,item:{id:'SEM-CA-SINTETICO'}}}:{body:{ok:true,items:[]}});syntheticAuth(app);
  app.elements.epiSemCa.checked=true;app.elements.caInput.value='CA-ANTIGO';app.elements.epiValidade.value='31/12/2099';app.run('updateEquipmentKind()');
  assert.equal(app.elements.caInput.required,false);assert.equal(app.elements.caInput.disabled,true);assert.equal(app.elements.caInput.value,'');assert.equal(app.elements.epiValidade.value,'');
  const form=app.elements.epiForm;form.fields={descricao:'UNIFORME SINTÉTICO',tipoCadastro:'sem_ca',ca:'CA-ANTIGO'};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  const body=JSON.parse(app.requests.find(item=>item.options.method==='POST').options.body);
  assert.equal(body.tipo,'sem_ca');assert.equal(body.ca,'');assert.equal(body.validade,'');assert.ok(!('empresaId' in body));
});

test('consulta de CA em andamento não preenche um cadastro alterado para Sem CA',async()=>{
  let finish;
  const app=appHarness(()=>new Promise(resolve=>{finish=resolve}));app.elements.caInput.value='123456';
  const pending=app.run('consultarCA()');app.elements.epiSemCa.checked=true;app.run('updateEquipmentKind()');
  finish({body:{ok:true,item:{found:true,description:'DESCRIÇÃO DE RESPOSTA ANTIGA',manufacturer:'FABRICANTE ANTIGO'}}});await pending;
  assert.equal(app.elements.epiDescricao.value,'');assert.equal(app.elements.caInput.value,'');
});

test('prévia de importação escapa o conteúdo recebido e bloqueia confirmação de linhas inválidas',()=>{
  const app=appHarness(initialRoute);syntheticAuth(app);app.run('saveActiveCompany("EMPRESA-TESTE")');
  const report={importacaoId:'IMPORTACAO-SINTETICA',status:'invalida',arquivoNome:'Arquivo.xlsx',podeConfirmar:false,resumo:{total:1,criar:0,atualizar:0,inalterados:0,erros:1},linhas:[{linha:2,nomeCompleto:'<img src=x onerror=alert(1)>',acao:'erro',erros:['CPF inválido <script>teste</script>']}]};
  app.context.syntheticReport=report;app.run('renderImportPreview(syntheticReport)');
  assert.equal(app.elements.trabalhadoresImportCommit.disabled,true);
  assert.ok(!app.elements.trabalhadoresImportRows.innerHTML.includes('<img'));
  assert.ok(!app.elements.trabalhadoresImportRows.innerHTML.includes('<script>'));
  assert.match(app.elements.trabalhadoresImportMessage.textContent,/nenhum cadastro será alterado/);
});

test('referência de importação pertence ao usuário e empresa, e logout limpa os dados da prévia',()=>{
  const app=appHarness(initialRoute);syntheticAuth(app,'EMPRESA','USUARIO-A');app.run('saveActiveCompany("EMPRESA-A")');
  const keyA=app.run('importReferenceKey()');app.run('saveImportReference({importacaoId:"IMPORTACAO-A",status:"pendente",expiresAt:"2099-01-01"})');
  app.run('saveActiveCompany("EMPRESA-B")');const keyB=app.run('importReferenceKey()');assert.notEqual(keyA,keyB);assert.equal(app.context.sessionStorage.getItem(keyB),null);
  syntheticAuth(app,'EMPRESA','USUARIO-B');app.run('saveActiveCompany("EMPRESA-A")');assert.notEqual(app.run('importReferenceKey()'),keyA);
  assert.ok(!app.context.sessionStorage.getItem(keyA).includes('nomeCompleto'));
  app.elements.trabalhadoresImportRows.innerHTML='DADOS SINTÉTICOS';app.elements.empresaCredentialsPassword.value='12345678';app.elements.logoutButton.click();
  assert.equal(app.elements.trabalhadoresImportRows.textContent,'');assert.equal(app.elements.empresaCredentialsPassword.value,'');assert.equal(app.run('importPreview'),null);
});

test('credenciais da empresa não reaparecem quando logout ocorre na recuperação final de prévia',async()=>{
  let finishImport;
  const created={...company,login:'login-sintetico',cnpj:'12.345.678/0000-00',acessoStatus:'ativo'};
  const app=appHarness((url,options)=>{
    if(url.includes('/api/trabalhadores/importacao/'))return new Promise(resolve=>{finishImport=resolve});
    if(options.method==='POST')return {body:{ok:true,item:created,acesso:{login:created.login,status:'ativo'}}};
    return initialRoute(url);
  });
  syntheticAuth(app);app.run('saveActiveCompany("EMPRESA-TESTE");saveImportReference({importacaoId:"IMPORTACAO-SINTETICA",status:"pendente",expiresAt:"2099-01-01"})');
  const form=app.elements.empresaForm;form.fields={nome:created.nome,login:created.login,cnpj:created.cnpj};
  const pending=form.listeners.submit[0]({preventDefault(){},target:form});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof finishImport,'function');
  app.elements.logoutButton.click();finishImport({body:{ok:true,importacaoId:'IMPORTACAO-SINTETICA',status:'pendente',podeConfirmar:true,resumo:{},linhas:[]}});await pending;
  assert.equal(app.elements.empresaCredentialsPassword.value,'');assert.equal(app.elements.empresaCredentialsPanel.classList.contains('hidden'),true);
  assert.equal(app.context.sessionStorage.getItem('jp-v12-auth'),null);
});

test('cadastro aguarda o processamento do logotipo selecionado antes de permitir envio',async()=>{
  const app=appHarness(initialRoute);syntheticAuth(app);
  app.run('normalizeLogo=()=>new Promise(resolve=>{window.finishSyntheticLogo=resolve})');
  const target={files:[{name:'LOGO-SINTETICO.png',type:'image/png',size:1200}],value:'LOGO-SINTETICO.png'};
  app.context.syntheticLogoEvent={target};
  const pending=app.run('selectLogo(syntheticLogoEvent,false)');
  const form=app.elements.empresaForm;form.fields={nome:'EMPRESA SINTÉTICA',login:'login-sintetico',cnpj:'12.345.678/0000-00'};
  assert.equal(form.submitButton.disabled,true);
  await form.listeners.submit[0]({preventDefault(){},target:form});assert.equal(app.requests.length,0);
  app.context.finishSyntheticLogo(pixel);await pending;assert.equal(form.submitButton.disabled,false);assert.equal(app.run('empresaLogoDraft'),pixel);
});

test('matrícula eSocial é texto sem limite de campo e conserva letras, números e zeros no cadastro e snapshot',async()=>{
  const matricula='000'+('Ab9'.repeat(240))+'Fim000';assert.ok(matricula.length>600);
  const record={...worker,matriculaESocial:matricula};
  const app=appHarness((url,options)=>options.method==='POST'?{body:{ok:true,item:record}}:url.endsWith('/api/trabalhadores')?{body:{ok:true,items:[record]}}:initialRoute(url));
  syntheticAuth(app);await app.run('refreshAll()');
  assert.equal(app.elements.trabalhadorMatricula.getAttribute('type'),'text');
  assert.equal(app.elements.trabalhadorMatricula.getAttribute('inputmode'),'text');
  assert.equal(app.elements.trabalhadorMatricula.getAttribute('maxlength'),null);
  assert.equal(app.elements.trabalhadorMatricula.getAttribute('pattern'),null);
  const form=app.elements.trabalhadorForm;form.fields={nomeCompleto:record.nomeCompleto,cpf:record.cpf,matriculaESocial:matricula,funcao:record.funcao,localidade:'LOCALIDADE SINTÉTICA'};
  await form.listeners.submit[0]({preventDefault(){},target:form});
  const request=app.requests.find(item=>item.options.method==='POST');assert.equal(JSON.parse(request.options.body).matriculaESocial,matricula);
  assert.ok(app.elements.trabalhadoresList.innerHTML.includes('Matrícula eSocial: '+matricula));
  app.elements.trabalhadorSearch.value='Fim000';app.run('renderTrabalhadores()');assert.ok(app.elements.trabalhadoresList.innerHTML.includes(matricula));
  assert.equal(app.run('cache.trabalhadores[0].matriculaESocial'),matricula);
  assert.ok(app.elements.entregaTrabalhador.innerHTML.includes('value="'+record.id+'"'));
  const snapshot=app.run('JP_FICHA.createSnapshot(cache.empresas[0],cache.trabalhadores[0])');assert.equal(snapshot.trabalhadorSnapshot.matriculaESocial,matricula);
});

test('prévia e sincronização preservam matrícula alfanumérica longa integralmente',async()=>{
  const matricula='000'+('Xy7'.repeat(240))+'Z000';assert.ok(matricula.length>600);
  const record={...worker,matriculaESocial:matricula};
  const report={importacaoId:'IMPORTACAO-MATRICULA-LONGA',status:'pendente',podeConfirmar:true,resumo:{total:1,criar:1,atualizar:0,inalterados:0,erros:0},linhas:[{linha:2,nomeCompleto:record.nomeCompleto,cpf:record.cpf,matriculaESocial:matricula,acao:'criar',erros:[]}]};
  const app=appHarness((url,options)=>url.endsWith('/confirmar')?{body:{ok:true,...report,status:'concluida',podeConfirmar:false,processados:1,total:1}}:url.endsWith('/api/trabalhadores')?{body:{ok:true,items:[record]}}:initialRoute(url));
  syntheticAuth(app);await app.run('refreshAll()');app.context.syntheticLongImport=report;app.run('renderImportPreview(syntheticLongImport)');
  assert.equal(app.run('importPreview.linhas[0].matriculaESocial'),matricula);
  await app.run('confirmWorkersImport()');
  assert.equal(app.run('importPreview.linhas[0].matriculaESocial'),matricula);
  assert.equal(app.run('cache.trabalhadores[0].matriculaESocial'),matricula);
  assert.ok(app.elements.trabalhadoresList.innerHTML.includes(matricula));
  assert.match(app.elements.trabalhadoresImportMessage.textContent,/Sincronização concluída/);
});

require('./biometria.test.cjs');

test('diagnóstico12.8.1 sem Java ou SDK mostra o motivo seguro sem pedir atualização da versão',async()=>{
  const expected={JAVA_NOT_FOUND:/Java não localizado/,JAVA_ARCH_MISMATCH:/Java e SDK com arquiteturas diferentes/,SDK_NOT_FOUND:/SDK NITGEN não localizado/,SDK_DLL_NOT_FOUND:/Bibliotecas do SDK NITGEN ausentes/,SDK_ARCH_MISMATCH:/Bibliotecas NITGEN incompatíveis entre si/};
  for(const [errorCode,title] of Object.entries(expected)){
    const app=appHarness(()=>({body:{ok:false,service:'JP Biometria Local',version:'12.8.1',runtime:'diagnostic-only',sdk:false,reader:false,deviceCount:0,capabilities:{capture:false,captureMethod:'POST',capturePath:'/api/capture'},errorCode,message:'TEMPLATE-PRIVADO-NÃO-EXIBIR'}}));
    await app.run('testBiometriaLocal()');assert.equal(app.elements.bioStatusBadge.dataset.state,'warning');assert.equal(app.elements.bioStatusBadge.textContent,'Requer atenção');assert.match(app.elements.bioStatusTitle.textContent,title);assert.ok(!app.elements.bioStatusText.textContent.includes('precisa ser atualizado'));assert.ok(!app.elements.bioStatusText.textContent.includes('PRIVADO'));assert.ok(app.elements.bioOutput.textContent.includes(errorCode));assert.equal(app.elements.bioRegisterButton.disabled,true);
  }
});
