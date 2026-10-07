// Fluxos da V12.8 com contas, documentos, logos e APIs inteiramente sintéticos.
// Usa contextos separados de navegador. Não faz chamadas a Cognito/AWS reais.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ExcelJS=require(require.resolve('exceljs',{paths:[path.join(__dirname,'../backend')]}));

module.exports=async function runTenantBrowser({browser,origin,output}){
  const result={syntheticData:true,realApiUsed:false,checks:[],layouts:{},requests:[]};
  const contexts=[];const pages=[];const errors=[];
  const passed=name=>{result.checks.push({name,passed:true});console.log('PASSOU: '+name);};
  const companyA={id:'EMPRESA-A-SINTETICA',nome:'EMPRESA ALFA SINTÉTICA',cnpj:'12.345.678/0000-00',localidade:'Cidade de Teste/MS',login:'empresa-alfa-sintetica',acessoStatus:'ativo',_version:1};
  const companyB={id:'EMPRESA-B-SINTETICA',nome:'EMPRESA BETA SINTÉTICA',cnpj:'98.765.432/0000-00',localidade:'Outra Cidade/SP',login:'empresa-beta-sintetica',acessoStatus:'ativo',_version:1};
  const legacy={id:'EMPRESA-LEGADA-SINTETICA',nome:'EMPRESA LEGADA SINTÉTICA',cnpj:'11.222.333/0001-81',localidade:'Cidade de Teste/MS',_version:1};
  const companies=[companyA,companyB,legacy];
  const longMatricula='000'+('Ab9'.repeat(240))+'Fim000';
  assert.ok(longMatricula.length>600);
  const cpf=index=>{let digits=String(index).padStart(9,'0');for(const weight of [10,11]){const sum=[...digits].reduce((total,value,i)=>total+Number(value)*(weight-i),0),rest=(sum*10)%11;digits+=rest===10?'0':String(rest);}return digits;};
  const rows=Array.from({length:500},(_,i)=>({id:'TRABALHADOR-ALFA-'+i,empresaId:companyA.id,nomeCompleto:i===0?'ÁLVARO SINTÉTICO':i===1?'BIA SINTÉTICA':i===499?'ZULMIRA SINTÉTICA':'TRABALHADOR SINTÉTICO '+String(i).padStart(3,'0'),cpf:cpf(i+1),matriculaESocial:i===0?longMatricula:String(i+1).padStart(6,'0'),funcao:'FUNÇÃO SINTÉTICA',localidade:'Cidade de Teste/MS',status:'Ativo'}));
  const workers={
    [companyA.id]:[{...rows[499]},{...rows[1],funcao:'FUNÇÃO ANTERIOR'}],
    [companyB.id]:[{id:'TRABALHADOR-BETA',empresaId:companyB.id,nomeCompleto:'TRABALHADOR EXCLUSIVO BETA',cpf:cpf(888888888),matriculaESocial:'BETA0001',funcao:'FUNÇÃO BETA',localidade:'Outra Cidade/SP',status:'Ativo'}],
    [legacy.id]:[]
  };
  const catalog=[{id:'EPI-GLOBAL-TESTE',descricao:'LUVA SINTÉTICA',ca:'123456',tipo:'epi_ca',semCA:false,fabricante:'FABRICANTE SINTÉTICO',catalogoCompartilhado:true}];
  let importProgress=0,loseOneResponse=true,confirmCalls=0,firstAccess=true,loginSequence=0,createRequest;
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Trabalhadores');
  sheet.addRow(['Nome completo*','CPF*','Matrícula eSocial*','Função*','Localidade*','Setor','Data de admissão','RG','E-mail','Telefone','Status','Observações']);
  for(const worker of rows)sheet.addRow([worker.nomeCompleto,worker.cpf,worker.matriculaESocial,worker.funcao,worker.localidade,'','','','','',worker.status,'']);
  sheet.getColumn(2).numFmt='@';sheet.getColumn(3).numFmt='@';
  const workbookBuffer=Buffer.from(await workbook.xlsx.writeBuffer());
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const tokenFor=(role,company,session)=>`${encode({alg:'RS256',typ:'JWT'})}.${encode({sub:role==='MASTER'?'MASTER-SINTETICO':company.login,'cognito:groups':[role],...(company?{'custom:empresa_id':company.id}:{}),session,exp:4102444800})}.ASSINATURA-SINTETICA`;
  const importReport=(invalid=false)=>({ok:true,importacaoId:invalid?'IMPORTACAO-INVALIDA':'IMPORTACAO-ALFA-SINTETICA',arquivoNome:invalid?'Equipe_Invalida.xlsx':'Equipe_Sintetica.xlsx',expiresAt:'2099-01-01T00:00:00Z',status:invalid?'invalida':importProgress>=500?'concluida':importProgress?'em_andamento':'pendente',podeConfirmar:!invalid&&importProgress<500,resumo:{total:invalid?1:500,criar:invalid?0:498,atualizar:invalid?0:1,inalterados:invalid?0:1,erros:invalid?1:0},processados:importProgress,total:500,lotesConcluidos:Math.ceil(importProgress/80),lotesTotal:7,linhas:invalid?[{linha:2,nomeCompleto:'<script>FALHA SINTÉTICA</script>',acao:'erro',erros:['CPF inválido na planilha sintética.']}]:rows.map((worker,i)=>({linha:i+2,nomeCompleto:worker.nomeCompleto,cpf:worker.cpf,matriculaESocial:worker.matriculaESocial,acao:i===1?'atualizar':i===499?'inalterado':'criar',camposAlterados:i===1?['funcao']:[],erros:[]}))});
  async function makeContext(role,company,{mobile=false}={}){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:900},locale:'pt-BR',timezoneId:mobile?'America/Sao_Paulo':'America/Campo_Grande'});contexts.push(context);
    const session=++loginSequence,token=tokenFor(role,company,session);let authorized=false;
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route(url=>url.origin!==origin,async route=>{
      const request=route.request(),url=new URL(request.url()),body=request.postData()?request.postDataJSON():{};
      const json=(status,payload)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(payload)});
      if(url.hostname.startsWith('cognito-idp.')){
        const operation=request.headers()['x-amz-target']||'';
        result.requests.push({kind:'authentication',operation:operation.split('.').pop(),session});
        if(operation.endsWith('.RespondToAuthChallenge')){
          assert.equal(body.ChallengeName,'NEW_PASSWORD_REQUIRED');assert.equal(body.Session,'DESAFIO-ALFA-SINTETICO');assert.equal(body.ChallengeResponses.NEW_PASSWORD,'SenhaDefinitivaSintetica8');firstAccess=false;
        }else{
          assert.equal(body.AuthParameters.USERNAME,role==='MASTER'?'master-sintetico':company.login);
          if(role==='EMPRESA'&&company===companyA&&firstAccess){
            if(body.AuthParameters.PASSWORD==='12345678')return json(400,{__type:'NotAuthorizedException',message:'Credencial sintética provisória.'});
            assert.equal(body.AuthParameters.PASSWORD,'JpEpi1-Inicial-12345678');
            return json(200,{ChallengeName:'NEW_PASSWORD_REQUIRED',Session:'DESAFIO-ALFA-SINTETICO',ChallengeParameters:{USER_ID_FOR_SRP:company.login,requiredAttributes:'[]'}});
          }
        }
        authorized=true;return json(200,{AuthenticationResult:{IdToken:token,AccessToken:'ACCESS-SINTETICO-'+session,ExpiresIn:3600}});
      }
      if(url.hostname==='127.0.0.1'&&url.pathname==='/status')return route.abort();
      if(!url.hostname.endsWith('.execute-api.sa-east-1.amazonaws.com')){result.unexpectedExternal=true;return route.abort();}
      if(url.pathname==='/health')return json(200,{ok:true,durable:true,storageReady:true});
      if(url.pathname==='/api/caepi/365')return json(200,{ok:true,item:{found:true,officialSnapshot:true,downloadedAt:'2026-10-06T16:00:00Z'}});
      const selected=request.headers()['x-empresa-id'];
      result.requests.push({kind:'api',path:url.pathname,method:request.method(),session,selected});
      if(!authorized||request.headers().authorization!==`Bearer ${token}`)return json(401,{ok:false,error:'Sessão sintética não autenticada.'});
      if(role!=='MASTER'&&selected&&selected!==company.id)return json(403,{ok:false,error:'Empresa não autorizada nesta sessão sintética.'});
      if(url.pathname==='/api/empresas'&&request.method()==='GET')return json(200,{ok:true,items:role==='MASTER'?companies:[company]});
      if(url.pathname==='/api/empresas'&&request.method()==='POST'){
        assert.equal(role,'MASTER');assert.match(body.requestId,/^[a-f0-9-]{36}$/);assert.ok(!Object.keys(body).some(key=>/senha|password|secret/i.test(key)));createRequest=body;
        const saved={...body,id:'EMPRESA-NOVA-SINTETICA',acessoStatus:'ativo',_version:1};delete saved.requestId;companies.push(saved);workers[saved.id]=[];
        return json(200,{ok:true,item:saved,acesso:{login:body.login,status:'ativo',trocaObrigatoria:true}});
      }
      if(/^\/api\/empresas\/[^/]+$/.test(url.pathname)&&request.method()==='PATCH'){
        const id=url.pathname.split('/').pop(),record=companies.find(item=>item.id===id);assert.ok(record);if(role!=='MASTER')assert.equal(id,company.id);
        assert.equal(body._version,record._version);assert.ok(Buffer.from(body.logoDataUrl.split(',')[1]||'','base64').length<=48*1024);record.logoDataUrl=body.logoDataUrl;record._version++;
        return json(200,{ok:true,item:record});
      }
      if(/^\/api\/empresas\/[^/]+\/acesso$/.test(url.pathname)){
        assert.equal(role,'MASTER');const record=companies.find(item=>item.id===url.pathname.split('/')[3]);record.login=body.login||record.login;record.acessoStatus='ativo';
        return json(200,{ok:true,item:record,acesso:{login:record.login,status:'ativo',trocaObrigatoria:true}});
      }
      if(url.pathname==='/api/trabalhadores'&&request.method()==='POST'){
        assert.equal(selected,companyB.id);assert.equal(body.matriculaESocial,longMatricula);
        const item={...body,id:'TRABALHADOR-MATRICULA-LONGA-SINTETICA'};workers[selected].push(item);return json(200,{ok:true,item});
      }
      if(url.pathname==='/api/trabalhadores')return json(200,{ok:true,items:workers[selected]||[]});
      if(url.pathname==='/api/fichas')return json(200,{ok:true,items:[]});
      if(url.pathname==='/api/epis'&&request.method()==='GET')return json(200,{ok:true,items:catalog});
      if(url.pathname==='/api/epis'&&request.method()==='POST'){
        assert.equal(body.tipo,'sem_ca');assert.equal(body.ca,'');assert.equal(body.validade,'');assert.ok(!Object.hasOwn(body,'empresaId'));
        const item={...body,id:'EQUIPAMENTO-SEM-CA-SINTETICO',semCA:true,catalogoCompartilhado:true};catalog.push(item);return json(200,{ok:true,item,reutilizado:false});
      }
      if(url.pathname==='/api/trabalhadores/importacao/previa'){
        assert.equal(selected,companyA.id);assert.equal(Buffer.from(body.arquivoBase64,'base64').readUInt16LE(0),0x4b50);
        const received=new ExcelJS.Workbook();await received.xlsx.load(Buffer.from(body.arquivoBase64,'base64'));
        assert.equal(received.getWorksheet('Trabalhadores').getRow(2).getCell(3).value,longMatricula,'matrícula longa chega integral no arquivo enviado');
        return json(200,importReport(body.arquivoNome==='Equipe_Invalida.xlsx'));
      }
      if(url.pathname==='/api/trabalhadores/importacao/IMPORTACAO-ALFA-SINTETICA')return json(200,importReport());
      if(url.pathname==='/api/trabalhadores/importacao/IMPORTACAO-ALFA-SINTETICA/confirmar'){
        assert.equal(selected,companyA.id);confirmCalls++;importProgress=Math.min(500,importProgress+80);
        for(const row of rows.slice(importProgress-80<0?0:importProgress===500?480:importProgress-80,importProgress)){
          const index=workers[companyA.id].findIndex(item=>item.id===row.id);if(index<0)workers[companyA.id].push({...row});else workers[companyA.id][index]={...row};
        }
        if(importProgress===160&&loseOneResponse){loseOneResponse=false;return route.abort('connectionreset');}
        return json(200,importReport());
      }
      return json(404,{ok:false,error:'Rota sintética não prevista: '+url.pathname});
    });
    const page=await context.newPage();pages.push(page);await page.goto(`${origin}/EntregaEPI/`);return {context,page,session,company};
  }
  async function login(app,password){await app.page.locator('#username').fill(app.company?.login||'master-sintetico');await app.page.locator('#password').fill(password);await app.page.locator('#loginButton').click();}
  async function loaded(page){await page.locator('#appShell:not(.hidden)').waitFor();await page.waitForFunction(()=>document.getElementById('empresaAtivaSelect').options.length>1);}
  async function navigate(page,screen){const mobile=await page.locator('#menuToggle').isVisible();if(mobile)await page.locator('#menuToggle').click();await page.locator(`.nav [data-screen="${screen}"]`).click();if(mobile)await page.locator('#primarySidebar').waitFor({state:'hidden'});}
  async function inspect(page,name){
    await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
    await page.waitForFunction(()=>window.scrollY===0);
    const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,activeElement:document.activeElement.id||document.activeElement.tagName,headerTop:document.querySelector('.app-header').getBoundingClientRect().top}));
    assert.ok(dimensions.document<=dimensions.viewport+1,`${name}: sem rolagem horizontal global`);assert.ok(dimensions.body<=dimensions.viewport+1,`${name}: conteúdo cabe na tela`);result.layouts[name]=dimensions;
    await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
  }
  try{
    const master=await makeContext('MASTER',null);await login(master,'SENHA-MASTER-SINTETICA');await loaded(master.page);
    await navigate(master.page,'empresas');assert.equal(await master.page.locator('#empresaForm').isVisible(),true);
    const logoData=await master.page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=400;const context=canvas.getContext('2d');context.fillStyle='#0b8447';context.font='bold 98px sans-serif';context.fillText('EMPRESA TESTE',50,235);return canvas.toDataURL('image/png');});
    const logo={name:'Logotipo_Sintetico.png',mimeType:'image/png',buffer:Buffer.from(logoData.split(',')[1],'base64')};
    await master.page.locator('#empresaNome').fill('NOVA EMPRESA CLIENTE SINTÉTICA');await master.page.locator('#empresaCnpj').fill('11.222.333/0001-81');assert.equal(await master.page.locator('#empresaLogin').inputValue(),'11222333000181');
    await master.page.locator('#empresaLogin').fill('nova-empresa-sintetica');await master.page.locator('#empresaLogoFile').setInputFiles(logo);await master.page.locator('#empresaLogoPreviewWrap:not(.hidden)').waitFor();
    await master.page.locator('#empresaForm button[type="submit"]').click();await master.page.locator('#empresaCredentialsPanel:not(.hidden)').waitFor();
    assert.equal(await master.page.locator('#empresaCredentialsLogin').inputValue(),'nova-empresa-sintetica');assert.equal(await master.page.locator('#empresaCredentialsPassword').inputValue(),'11222333');
    assert.ok(Buffer.from(createRequest.logoDataUrl.split(',')[1],'base64').length<=48*1024);assert.ok(createRequest.logoDataUrl.startsWith('data:image/png;'));
    await master.page.locator('#empresaCredentialsDismiss').click();assert.equal(await master.page.locator('#empresaCredentialsPassword').inputValue(),'');
    await inspect(master.page,'desktop-master-empresas');passed('Master cadastra empresa, normaliza logotipo transparente e exibe acesso inicial descartável');

    const alpha=await makeContext('EMPRESA',companyA);await login(alpha,'12345678');await alpha.page.locator('#newPasswordForm:not(.hidden)').waitFor();
    assert.equal(await alpha.page.locator('#password').inputValue(),'');assert.equal(await alpha.page.evaluate(()=>sessionStorage.getItem('jp-v12-auth')),null);
    await inspect(alpha.page,'desktop-primeiro-acesso');await alpha.page.locator('#newPassword').fill('SenhaDefinitivaSintetica8');await alpha.page.locator('#newPasswordConfirm').fill('SenhaDefinitivaSintetica8');await alpha.page.locator('#newPasswordButton').click();await loaded(alpha.page);
    assert.equal(await alpha.page.locator('#newPassword').inputValue(),'');assert.equal(await alpha.page.locator('#empresaAtivaSelect').isDisabled(),true);
    await navigate(alpha.page,'empresas');assert.equal(await alpha.page.locator('#empresaForm').isVisible(),false);assert.equal(await alpha.page.locator('#empresaAccessForm').isVisible(),false);assert.equal(await alpha.page.locator('#empresasList .item').count(),1);
    await alpha.page.locator('#empresaLogoAtualFile').setInputFiles(logo);await alpha.page.waitForFunction(()=>!document.getElementById('empresaLogoSave').disabled);await alpha.page.locator('#empresaLogoSave').click();await alpha.page.waitForFunction(()=>document.getElementById('appMessage').textContent.includes('Logotipo atualizado'));
    await inspect(alpha.page,'desktop-minha-empresa');passed('primeiro acesso define senha sem persistir credenciais e empresa altera somente seu logotipo');

    const second=await makeContext('EMPRESA',companyA,{mobile:true});await login(second,'SenhaDefinitivaSintetica8');await loaded(second.page);
    const beta=await makeContext('EMPRESA',companyB);await login(beta,'SENHA-BETA-SINTETICA');await loaded(beta.page);
    assert.equal(await second.page.locator('#empresaAtivaSelect').inputValue(),companyA.id);assert.equal(await beta.page.locator('#empresaAtivaSelect').inputValue(),companyB.id);
    await navigate(alpha.page,'trabalhadores');assert.ok((await alpha.page.locator('#trabalhadoresList').innerText()).includes('BIA'));assert.ok(!(await alpha.page.locator('#trabalhadoresList').innerText()).includes('EXCLUSIVO BETA'));
    const downloadPromise=alpha.page.waitForEvent('download');await alpha.page.locator('#trabalhadoresTemplateButton').click();const download=await downloadPromise;
    const downloaded=await download.path();assert.equal(fs.readFileSync(downloaded).readUInt16LE(0),0x4b50);assert.equal(download.suggestedFilename(),'Modelo_Trabalhadores_JP_EntregaEPI.xlsx');
    await alpha.page.locator('#trabalhadoresImportFile').setInputFiles({name:'Equipe_Sintetica.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbookBuffer});await alpha.page.waitForFunction(()=>document.querySelectorAll('#trabalhadoresImportRows tr').length===500);
    assert.equal(await alpha.page.locator('#trabalhadoresImportCommit').isDisabled(),false);await inspect(alpha.page,'desktop-importacao-previa');
    await alpha.page.locator('#trabalhadoresImportCommit').click();await alpha.page.waitForFunction(()=>document.getElementById('trabalhadoresImportMessage').textContent.includes('interrompida'));
    assert.equal(importProgress,160);await alpha.page.reload();await loaded(alpha.page);await navigate(alpha.page,'trabalhadores');await alpha.page.waitForFunction(()=>document.getElementById('trabalhadoresImportContext').textContent.includes('160 de 500'));
    await alpha.page.locator('#trabalhadoresImportCommit').click();await alpha.page.waitForFunction(()=>document.getElementById('trabalhadoresImportMessage').textContent.includes('Sincronização concluída'));
    assert.equal(importProgress,500);assert.equal(confirmCalls,7);assert.equal(workers[companyA.id].length,500);assert.equal(new Set(workers[companyA.id].map(item=>item.id)).size,500);
    await alpha.page.waitForFunction(()=>document.querySelectorAll('#trabalhadoresList .item').length===500);const names=await alpha.page.locator('#trabalhadoresList .item strong').allTextContents();assert.equal(names[0],'ÁLVARO SINTÉTICO');assert.equal(names.at(-1),'ZULMIRA SINTÉTICA');
    assert.equal(workers[companyA.id].find(item=>item.id===rows[0].id).matriculaESocial,longMatricula);
    assert.ok((await alpha.page.locator('#trabalhadoresList .item').filter({hasText:'ÁLVARO SINTÉTICO'}).innerText()).includes(longMatricula));
    passed('Excel de 500 linhas sincroniza em sete lotes e retoma após perda da resposta e recarga da página');

    await alpha.page.locator('#trabalhadoresImportFile').setInputFiles({name:'Equipe_Invalida.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbookBuffer});await alpha.page.waitForFunction(()=>document.querySelector('#trabalhadoresImportRows tr')?.textContent.includes('CPF inválido'));
    assert.equal(await alpha.page.locator('#trabalhadoresImportCommit').isDisabled(),true);assert.equal(await alpha.page.locator('#trabalhadoresImportRows script').count(),0);assert.equal(confirmCalls,7);assert.equal(workers[companyB.id].length,1);
    await navigate(second.page,'trabalhadores');await second.page.locator('#screen-trabalhadores .topbar button').click();await second.page.waitForFunction(()=>document.querySelectorAll('#trabalhadoresList .item').length===500);await second.page.locator('#trabalhadorSearch').fill('alvaro');assert.equal(await second.page.locator('#trabalhadoresList .item').count(),1);
    assert.ok((await second.page.locator('#trabalhadoresList .item').innerText()).includes(longMatricula));
    assert.equal(await second.page.locator('#trabalhadoresList .item').evaluate(item=>item.scrollWidth<=item.clientWidth+1),true,'matrícula longa quebra dentro do cartão no celular');
    await inspect(second.page,'mobile-trabalhadores');await navigate(beta.page,'trabalhadores');assert.equal(await beta.page.locator('#trabalhadoresList .item').count(),1);assert.match(await beta.page.locator('#trabalhadoresList').innerText(),/EXCLUSIVO BETA/);
    passed('prévia inválida bloqueia escrita e a sincronização fica restrita à empresa selecionada');

    const matriculaInput=beta.page.locator('#trabalhadorMatricula');
    assert.equal(await matriculaInput.getAttribute('type'),'text');assert.equal(await matriculaInput.getAttribute('maxlength'),null);assert.equal(await matriculaInput.getAttribute('pattern'),null);
    await beta.page.locator('#trabalhadorNome').fill('COLABORADOR COM MATRÍCULA LONGA');await beta.page.locator('#trabalhadorCpf').fill(cpf(543210987));
    await matriculaInput.fill(longMatricula);assert.equal(await matriculaInput.inputValue(),longMatricula);
    await beta.page.locator('#trabalhadorFuncao').fill('FUNÇÃO SINTÉTICA');await beta.page.locator('#trabalhadorLocalidade').fill('LOCALIDADE SINTÉTICA');
    await beta.page.locator('#trabalhadorForm button[type="submit"]').click();await beta.page.waitForFunction(()=>document.querySelectorAll('#trabalhadoresList .item').length===2);
    const longItem=beta.page.locator('#trabalhadoresList .item').filter({hasText:'COLABORADOR COM MATRÍCULA LONGA'});
    assert.ok((await longItem.innerText()).includes(longMatricula));assert.equal(await longItem.evaluate(item=>item.scrollWidth<=item.clientWidth+1),true);
    await inspect(beta.page,'desktop-matricula-alfanumerica-longa');
    passed('matrícula alfanumérica de 729 caracteres mantém letras, números e zeros no cadastro, Excel e lista móvel');

    await navigate(second.page,'epis');await second.page.locator('#epiSemCa').check();assert.equal(await second.page.locator('#caInput').isVisible(),false);assert.equal(await second.page.locator('#epiValidade').isVisible(),false);
    await second.page.locator('#epiNome').fill('UNIFORME COMPARTILHADO SINTÉTICO');await second.page.locator('#epiFabricante').fill('FABRICANTE SINTÉTICO');await second.page.locator('#epiModelo').fill('Modelo de teste');await second.page.locator('#epiTamanho').fill('G');
    await second.page.locator('#epiForm button[type="submit"]').click();await second.page.waitForFunction(()=>document.getElementById('episList').textContent.includes('UNIFORME COMPARTILHADO SINTÉTICO'));await second.page.locator('#epiSemCa').check();await inspect(second.page,'mobile-equipamento-sem-ca');
    await navigate(beta.page,'epis');await beta.page.locator('#screen-epis .topbar button').click();await beta.page.waitForFunction(()=>document.getElementById('episList').textContent.includes('UNIFORME COMPARTILHADO SINTÉTICO'));
    await navigate(master.page,'epis');await master.page.locator('#screen-epis .topbar button').click();await master.page.waitForFunction(()=>document.getElementById('episList').textContent.includes('UNIFORME COMPARTILHADO SINTÉTICO'));await inspect(master.page,'desktop-catalogo-compartilhado');
    assert.ok(!(await beta.page.locator('#episList').innerText()).includes(companyA.nome));passed('equipamento sem CA entra no catálogo comum e fica disponível à outra empresa e ao Master sem autoria');

    await alpha.page.locator('#logoutButton').click();assert.equal(await alpha.page.evaluate(()=>sessionStorage.getItem('jp-v12-auth')),null);
    assert.ok(await second.page.evaluate(()=>sessionStorage.getItem('jp-v12-auth')));await navigate(second.page,'dashboard');await second.page.locator('#refreshButton').click();await second.page.waitForFunction(()=>document.getElementById('metricTrabalhadores').textContent==='500');
    assert.equal(await second.page.locator('#appShell').isVisible(),true);assert.equal(result.requests.filter(item=>item.operation==='GlobalSignOut').length,0);
    passed('duas sessões da mesma empresa funcionam simultaneamente e sair de uma mantém a outra autenticada');
    assert.deepEqual(errors,[]);assert.ok(!result.unexpectedExternal);result.passed=true;return result;
  }catch(error){result.passed=false;result.error=error.message;for(let i=0;i<pages.length;i++){if(!pages[i].isClosed())await pages[i].screenshot({path:path.join(output,`tenant-falha-${i}.png`),fullPage:false}).catch(()=>{});}throw error;}
  finally{fs.writeFileSync(path.join(output,'tenant-browser-results.json'),JSON.stringify(result,null,2)+'\n');await Promise.all(contexts.map(context=>context.close()));}
};
