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
    querySelectorAll:selector=>selector==='.nav button'?nav:selector==='.screen'?Object.values(elements).filter(item=>item.id.startsWith('screen-')):[],
    querySelector:selector=>selector==='.brand-logo'?{src:pixel}:nav.find(item=>selector===`[data-screen="${item.dataset.screen}"]`)||null};
  for(const item of [...Object.values(elements),...nav,document.body])item.ownerDocument=document;
  for(const match of index.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    const item=elements[match[1]];
    for(const attribute of match[0].matchAll(/([\w:-]+)="([^"]*)"/g))item.setAttribute(attribute[1],attribute[2]);
  }
  const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)}};
  const requests=[];
  const context=vm.createContext({console,Date,JSON,Promise,Number,String,Array,Object,Error,RegExp,Boolean,decodeURIComponent,escape,
    atob:value=>Buffer.from(value,'base64').toString('binary'),localStorage:storage(),sessionStorage:storage(),alert:()=>{},setTimeout,clearTimeout,AbortController,URL,
    addEventListener(event,listener){(windowListeners[event]||=[]).push(listener)},
    FormData:class {constructor(form){this.form=form}entries(){return Object.entries(this.form.fields||{})}},
    document,
    fetch:async(url,options={})=>{requests.push({url,options});const answer=await route(url,options);return {status:answer.status||200,ok:(answer.status||200)<400,text:async()=>JSON.stringify(answer.body),json:async()=>answer.body}}
  });
  context.window=context;
  context.JP_CONFIG={apiBaseUrl:'https://api.example.test',version:'12.7.2'};
  vm.runInContext(moduleSource,context);
  vm.runInContext(appSource,context);
  return {context,elements,requests,documentListeners,windowListeners,run:code=>vm.runInContext(code,context)};
}
const initialRoute=url=>({body:{ok:true,items:url.endsWith('/api/empresas')?[company]:url.endsWith('/api/trabalhadores')?[worker]:url.endsWith('/api/epis')?[epi]:url.endsWith('/api/fichas')?[ficha]:[]}});

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
  assert.equal(app.elements.configVersion.textContent,'12.7.2');
  assert.equal(app.elements.configEnvironment.textContent,'Produção');
  assert.equal(app.elements.configCompany.textContent,company.nome);
  assert.equal(app.elements.configProfile.textContent,'Master');
  app.context.sessionStorage.setItem('jp-v12-auth',JSON.stringify({idToken:'TEST_ID_TOKEN',expiresAt:Date.now()+60000,payload:{}}));
  app.run('renderConfigSummary()');
  assert.equal(app.elements.configProfile.textContent,'Perfil não configurado','autenticação sem grupo não ganha perfil de administrador');
});

test('diagnóstico da API só apresenta operação pronta quando a persistência está confirmada',async()=>{
  let durable=false;
  const app=appHarness(()=>({body:{ok:true,version:'12.7.2',storageReady:true,durable}}));
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

test('HTTP 200 biométrico confirma somente acesso ao serviço local',async()=>{
  const app=appHarness(()=>({body:{ok:true,service:'SERVICO-SINTETICO'}}));
  await app.run('testBiometriaLocal()');
  assert.equal(app.elements.bioStatusBadge.textContent,'Serviço acessível');
  assert.equal(app.elements.bioStatusBadge.dataset.state,'success');
  assert.match(app.elements.bioStatusText.textContent,/não confirma .*detecção do leitor.*captura.*verificação.*assinatura biométrica/i);
  assert.equal(app.elements.bioTestButton.disabled,false);
  assert.equal(app.requests.length,1);
  assert.equal(app.requests[0].url,'http://127.0.0.1:8789/status');
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
