(function ensureConfig(){if(!window.JP_CONFIG||!window.JP_CONFIG.apiBaseUrl){window.JP_CONFIG={version:"12.7.2",appBasePath:"/EntregaEPI/",apiBaseUrl:"https://g4pdu3t1va.execute-api.sa-east-1.amazonaws.com",cognitoRegion:"sa-east-1",userPoolId:"sa-east-1_3FNCoTvr0",clientId:"2q2inha617oeer4vb0m0hjoja0",ambiente:"producao"}}})();
const $=id=>document.getElementById(id), tokenKey="jp-v12-auth", rememberedUserKey="jp-v12-remembered-user", activeCompanyKey="jp-v12-active-company";
let sessionGeneration=0;let lastSessionUsername="";let cache={empresas:[],trabalhadores:[],epis:[],fichas:[]};let activeEmpresaId=localStorage.getItem(activeCompanyKey)||"";
const screenLabels={dashboard:"Dashboard",empresas:"Empresas",trabalhadores:"Trabalhadores",epis:"EPIs e CA",entrega:"Entrega de EPI",fichas:"Fichas de EPI",biometria:"Biometria",config:"Configurações"};
const navigationMedia=typeof window.matchMedia==="function"?window.matchMedia("(max-width: 1024px)"):null;
function setText(id,value){const node=$(id);if(node)node.textContent=value;}
function setStatusBadge(id,label,state){const node=$(id);if(node){node.textContent=label;node.dataset.state=state;}}
function renderConfigSummary(){
  const cfg=window.JP_CONFIG||{},auth=getAuth();
  const empresa=cache.empresas.find(item=>String(item.id)===String(activeEmpresaId));
  const rawGroups=auth?.payload?.["cognito:groups"];
  const groups=Array.isArray(rawGroups)?rawGroups:typeof rawGroups==="string"?rawGroups.split(",").map(value=>value.trim()):[];
  setText("configVersion",cfg.version||"Não informada");
  setText("configEnvironment",cfg.ambiente==="producao"?"Produção":cfg.ambiente||"Não informado");
  setText("configCompany",empresa?.nome||"Nenhuma empresa selecionada");
  setText("configProfile",!auth?"Não autenticado":groups.includes("MASTER")?"Master":groups.includes("EMPRESA")?"Empresa":"Perfil não configurado");
  setText("configOutput",JSON.stringify(cfg,null,2));
}
function resetDiagnostics(){
  setStatusBadge("apiStatusBadge","Não verificado","idle");setText("apiStatusText","Verifique a conexão com o sistema quando precisar.");
  setStatusBadge("caStatusBadge","Não verificada","idle");setText("caStatusText","Consulte um CA para verificar a disponibilidade da base.");
  setStatusBadge("bioStatusBadge","Não verificado","idle");setText("bioStatusTitle","Verifique a conexão local");
  setText("bioStatusText","Inicie a verificação para saber se o serviço do leitor responde neste computador.");
  setText("bioCheckedAt","Nenhuma verificação nesta sessão.");
  setText("apiOutput","Nenhuma verificação realizada nesta sessão.");setText("bioOutput","Nenhuma verificação realizada nesta sessão.");
  ["healthTestButton","caTestButton","bioTestButton"].forEach(id=>{if($(id))$(id).disabled=false;});
}
function setSidebarOpen(open,returnFocus=false){
  const mobile=navigationMedia?.matches===true,expanded=mobile&&open;
  $("appShell").classList.toggle("sidebar-open",expanded);
  document.body.classList.toggle("menu-open",expanded);
  const sidebar=$("primarySidebar"),main=$("mainContent"),toggle=$("menuToggle");
  if(sidebar)sidebar.inert=mobile&&!expanded;
  if(main)main.inert=expanded;
  if(toggle){toggle.setAttribute("aria-expanded",String(expanded));toggle.setAttribute("aria-label",expanded?"Fechar menu":"Abrir menu");}
  if(expanded)$("sidebarClose")?.focus();
  else if(returnFocus&&mobile)toggle?.focus();
}
function activateScreen(screen,focusContent=true){
  if(!Object.prototype.hasOwnProperty.call(screenLabels,screen))return;
  document.querySelectorAll(".nav button").forEach(button=>{
    const active=button.dataset.screen===screen;button.classList.toggle("active",active);
    if(active)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".screen").forEach(section=>section.classList.toggle("active",section.id==="screen-"+screen));
  setText("currentSectionLabel",screenLabels[screen]);setSidebarOpen(false);
  if(focusContent)$("mainContent")?.focus({preventScroll:true});
}
function setMsg(type,text){const el=$("loginMessage");el.className="message "+type;el.textContent=text}function hideMsg(){$("loginMessage").className="message hidden";$("loginMessage").textContent=""}
function parseJwt(token){try{const payload=token.split(".")[1];const json=atob(payload.replace(/-/g,"+").replace(/_/g,"/"));return JSON.parse(decodeURIComponent(escape(json)))}catch(e){return {}}}
function saveAuth(auth,username){if(lastSessionUsername&&lastSessionUsername!==username)clearSessionData(true);lastSessionUsername=username;sessionStorage.setItem(tokenKey,JSON.stringify({username,idToken:auth.IdToken,accessToken:auth.AccessToken,refreshToken:auth.RefreshToken,expiresAt:Date.now()+((auth.ExpiresIn||3600)*1000),payload:parseJwt(auth.IdToken||"")}))}
function getAuth(){try{const raw=sessionStorage.getItem(tokenKey);if(!raw)return null;const auth=JSON.parse(raw);lastSessionUsername=auth.username||lastSessionUsername;if(!auth.expiresAt||auth.expiresAt<Date.now()){sessionStorage.removeItem(tokenKey);return null}return auth}catch(e){return null}}
async function cognitoLogin(username,password){const cfg=window.JP_CONFIG;const res=await fetch("https://cognito-idp."+cfg.cognitoRegion+".amazonaws.com/",{method:"POST",headers:{"Content-Type":"application/x-amz-json-1.1","X-Amz-Target":"AWSCognitoIdentityProviderService.InitiateAuth"},body:JSON.stringify({AuthFlow:"USER_PASSWORD_AUTH",ClientId:cfg.clientId,AuthParameters:{USERNAME:username,PASSWORD:password}})});const text=await res.text();let data={};try{data=JSON.parse(text)}catch(e){data={message:text}}if(!res.ok)throw new Error(data.message||data.__type||"Usuário ou senha inválidos.");if(data.ChallengeName)throw new Error("Desafio Cognito pendente: "+data.ChallengeName+". Defina senha permanente pelo CloudShell.");return data.AuthenticationResult}
async function api(path,opts={}){const requestSession=sessionGeneration;const cfg=window.JP_CONFIG;const auth=getAuth();const headers=Object.assign({},opts.headers||{});if(auth&&auth.idToken)headers.Authorization="Bearer "+auth.idToken;if(activeEmpresaId)headers["x-empresa-id"]=activeEmpresaId;if(opts.body&&!headers["content-type"])headers["content-type"]="application/json";const res=await fetch(cfg.apiBaseUrl+path,Object.assign({},opts,{headers}));const text=await res.text();let body=text;try{body=JSON.parse(text)}catch(e){}if(requestSession!==sessionGeneration){const error=new Error("A sessão mudou durante a consulta.");error.code="SESSION_CHANGED";throw error;}return {status:res.status,body}}
function write(data){$("apiOutput").textContent=typeof data==="string"?data:JSON.stringify(data,null,2)}function asArray(resp){return resp&&resp.body&&Array.isArray(resp.body.items)?resp.body.items:[]}function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function ensureSuccess(result, fallback="Não foi possível concluir a operação.") {
  if (result.status < 200 || result.status >= 300 || result.body?.ok === false) {
    const message = result.body?.error || result.body?.message || fallback;
    const error = new Error(typeof message === "string" ? message : fallback);
    error.status = result.status;
    throw error;
  }
  return result;
}
function clearSessionData(clearDrafts=false) {
  sessionGeneration++;
  cache={empresas:[],trabalhadores:[],epis:[],fichas:[]};
  activeEmpresaId="";localStorage.removeItem(activeCompanyKey);
  ["empresasList","trabalhadoresList","episList","fichasList","dashboardFichas","nextActions"].forEach(id=>$(id).textContent="");
  ["metricEmpresas","metricTrabalhadores","metricEpis","metricFichas"].forEach(id=>$(id).textContent=0);
  $("empresaAtivaSelect").innerHTML='<option value="">Selecione uma empresa</option>';
  $("userBadge").textContent="Usuário autenticado";
  resetDiagnostics();renderConfigSummary();setSidebarOpen(false);
  clearAppError();renderEntregaOptions();$("caMessage").className="message hidden";$("caMessage").textContent="";
  if(clearDrafts)["empresaForm","trabalhadorForm","epiForm","entregaForm"].forEach(id=>$(id).reset());
}
function handleAppError(error) {
  if (error.code === "SESSION_CHANGED") return;
  if (error.status === 401) {
    sessionStorage.removeItem(tokenKey);
    showLogin();
    setMsg("error", "Sua sessão expirou. Entre novamente para continuar.");
    return;
  }
  const message = $("appMessage");
  message.className = "message error";
  message.textContent = error.status === 403
    ? (error.message || "Seu usuário não possui permissão para acessar estes dados. Solicite ao administrador a configuração do perfil.")
    : (error.message || "Não foi possível carregar os dados. Tente novamente.");
}
function clearAppError() { $("appMessage").className="message hidden"; $("appMessage").textContent=""; }
function itemHtml(obj,lines=[],actions=""){return `<div class="item"><strong>${escapeHtml(obj.nome||obj.nomeCompleto||obj.name||obj.descricao||obj.numero||obj.id||"Registro")}</strong>${lines.filter(Boolean).map(x=>`<small>${escapeHtml(x)}</small>`).join("")}${actions}</div>`}
function formDataObj(form){return Object.fromEntries(new FormData(form).entries())}function requireEmpresa(){if(!activeEmpresaId){alert("Cadastre ou selecione uma empresa antes de continuar.");goScreen("empresas");return false}return true}
async function testHealth(){
  const button=$("healthTestButton"),generation=sessionGeneration;if(button?.disabled)return;
  if(button)button.disabled=true;
  setStatusBadge("apiStatusBadge","Verificando","loading");setText("apiStatusText","Conferindo a conexão e o armazenamento dos cadastros.");write("Verificando conexão...");
  try{
    const result=ensureSuccess(await api("/health"),"O sistema não respondeu à verificação.");write(result);
    const ready=result.body?.ok===true&&result.body?.durable===true&&result.body?.storageReady===true;
    setStatusBadge("apiStatusBadge",ready?"Operacional":"Requer atenção",ready?"success":"warning");
    setText("apiStatusText",ready?"Conexão disponível e armazenamento dos cadastros pronto para uso.":"O serviço respondeu, mas não confirmou que o armazenamento está pronto. Tente novamente ou contate o administrador.");
  }catch(error){if(generation!==sessionGeneration||error.code==="SESSION_CHANGED")return;setStatusBadge("apiStatusBadge","Indisponível","error");setText("apiStatusText","Não foi possível verificar o sistema. Confira a conexão e tente novamente.");write(error.message);}
  finally{if(button&&generation===sessionGeneration)button.disabled=false;}
}
async function testCA(){
  const button=$("caTestButton"),generation=sessionGeneration;if(button?.disabled)return;
  if(button)button.disabled=true;
  setStatusBadge("caStatusBadge","Consultando","loading");setText("caStatusText","Verificando a consulta do CA 365.");write("Consultando CA 365...");
  try{
    const result=ensureSuccess(await api("/api/caepi/365"),"A consulta de CA não respondeu.");write(result);
    const item=result.body?.item||{};
    if(item.ambiguous===true||item.autofillAllowed===false||item.found!==true){
      setStatusBadge("caStatusBadge","Conferência necessária","warning");
      setText("caStatusText",item.warning||"O CA consultado precisa de confirmação na fonte oficial.");
    }else if(item.officialSnapshot===true){
      const date=new Date(item.downloadedAt||"");
      const label=Number.isNaN(date.getTime())?"":" em "+date.toLocaleDateString("pt-BR");
      setStatusBadge("caStatusBadge","Base disponível","success");
      setText("caStatusText",`CA 365 localizado na cópia oficial obtida${label}. Atualizações devem ser conferidas no portal do MTE.`);
    }else{
      setStatusBadge("caStatusBadge","Base complementar","warning");
      setText("caStatusText","CA localizado em base complementar, sem confirmação atual no MTE. Confira os dados no portal oficial.");
    }
  }catch(error){if(generation!==sessionGeneration||error.code==="SESSION_CHANGED")return;setStatusBadge("caStatusBadge","Indisponível","error");setText("caStatusText","Não foi possível consultar o CA. Tente novamente ou abra a consulta oficial do MTE.");write(error.message);}
  finally{if(button&&generation===sessionGeneration)button.disabled=false;}
}
async function refreshAll(){
  clearAppError();
  await refreshEmpresas(false);
  if(activeEmpresaId){
    await Promise.all([refreshTrabalhadores(false),refreshEpis(false),refreshFichas(false)]);
  }else{
    cache.trabalhadores=[];cache.epis=[];cache.fichas=[];
    $("trabalhadoresList").textContent="Selecione uma empresa.";
    $("episList").textContent="Selecione uma empresa.";
    $("fichasList").textContent="Selecione uma empresa.";
    renderEntregaOptions();
  }
  $("metricEmpresas").textContent=cache.empresas.length;
  $("metricTrabalhadores").textContent=cache.trabalhadores.length;
  $("metricEpis").textContent=cache.epis.length;
  $("metricFichas").textContent=cache.fichas.length;
  renderDashboard();
  renderConfigSummary();
}
function renderDashboard(){const banner=$("actionBanner");if(!activeEmpresaId){banner.classList.remove("hidden")}else banner.classList.add("hidden");const actions=[];if(!cache.empresas.length)actions.push("Cadastre a primeira empresa.");if(activeEmpresaId&&!cache.trabalhadores.length)actions.push("Cadastre trabalhadores da empresa selecionada.");if(activeEmpresaId&&!cache.epis.length)actions.push("Cadastre EPIs ou consulte o CA 365.");if(activeEmpresaId&&cache.trabalhadores.length&&cache.epis.length)actions.push("Gere uma ficha de EPI.");$("nextActions").innerHTML=actions.length?actions.map(a=>`<div class="item"><strong>${escapeHtml(a)}</strong></div>`).join(""):'<div class="item"><strong>Fluxo inicial concluído.</strong><small>Você já pode gerar e acompanhar fichas de EPI.</small></div>';$("dashboardFichas").innerHTML=cache.fichas.length?cache.fichas.slice(0,6).map(f=>itemHtml(f,[f.trabalhadorNome||f.trabalhadorId,f.tipo,f.status,f.data])).join(""):"Nenhuma ficha gerada para a empresa selecionada."}
async function refreshEmpresas(update=true){const r=await api("/api/empresas");ensureSuccess(r,"Não foi possível carregar as empresas.");cache.empresas=asArray(r);renderEmpresas();if(update)await refreshAllSafe();return r}
function renderEmpresas(){const el=$("empresasList"),sel=$("empresaAtivaSelect");if(!el||!sel)return;sel.innerHTML='<option value="">Selecione uma empresa</option>';if(!cache.empresas.some(e=>String(e.id)===String(activeEmpresaId))){activeEmpresaId=cache.empresas[0]?.id||"";localStorage.setItem(activeCompanyKey,activeEmpresaId)}if(!cache.empresas.length){el.textContent="Nenhuma empresa cadastrada.";return}el.innerHTML=cache.empresas.map(e=>itemHtml(e,[e.cnpj,e.localidade,e.status])).join("");cache.empresas.forEach(e=>{const o=document.createElement("option");o.value=e.id;o.textContent=e.nome||"Empresa";if(e.id===activeEmpresaId)o.selected=true;sel.appendChild(o)})}
async function refreshTrabalhadores(update=true){if(!activeEmpresaId){$("trabalhadoresList").textContent="Selecione uma empresa.";return}const r=await api("/api/trabalhadores");ensureSuccess(r,"Não foi possível carregar os trabalhadores.");cache.trabalhadores=asArray(r);$("trabalhadoresList").innerHTML=cache.trabalhadores.length?cache.trabalhadores.map(t=>itemHtml(t,[t.cpf,t.funcao,t.matriculaESocial,t.status])).join(""):"Nenhum trabalhador cadastrado.";renderEntregaOptions();if(update)await refreshAllSafe();return r}
async function refreshEpis(update=true){if(!activeEmpresaId){$("episList").textContent="Selecione uma empresa.";return}const r=await api("/api/epis");ensureSuccess(r,"Não foi possível carregar os EPIs.");cache.epis=asArray(r);$("episList").innerHTML=cache.epis.length?cache.epis.map(e=>itemHtml(e,[`CA ${e.ca||""}`,e.fabricante,e.validade||e.validity,e.situacao||e.status])).join(""):"Nenhum EPI cadastrado.";renderEntregaOptions();if(update)await refreshAllSafe();return r}
async function refreshFichas(update=true){if(!activeEmpresaId){$("fichasList").textContent="Selecione uma empresa.";return}const r=await api("/api/fichas");ensureSuccess(r,"Não foi possível carregar as fichas.");cache.fichas=asArray(r);$("fichasList").innerHTML=cache.fichas.length?cache.fichas.map(f=>itemHtml(f,[f.trabalhadorNome||f.trabalhadorId,f.tipo,f.status,f.data],`<div style="margin-top:10px"><button class="btn btn-secondary" data-ficha-id="${escapeHtml(f.id)}" onclick="imprimirFicha(this.dataset.fichaId)">Visualizar/Imprimir</button></div>`)).join(""):"Nenhuma ficha cadastrada.";if(update)await refreshAllSafe();return r}
async function refreshAllSafe(){try{await refreshAll()}catch(error){handleAppError(error)}}
function renderEntregaOptions(){const tsel=$("entregaTrabalhador"),esel=$("entregaEpi");if(tsel)tsel.innerHTML=cache.trabalhadores.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.nomeCompleto||t.nome||"Trabalhador")}</option>`).join("");if(esel)esel.innerHTML=cache.epis.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml((e.descricao||e.name||"EPI")+" - CA "+(e.ca||""))}</option>`).join("")}
async function consultarCA(){
  const ca=$("caInput").value.trim();
  const message=$("caMessage");
  if(!ca){message.className="message warn";message.textContent="Informe o número do CA.";return;}
  ["epiDescricao","epiFabricante","epiValidade","epiSituacao"].forEach(id=>$(id).value="");
  message.className="message warn";message.textContent="Consultando CA...";
  try{
    const result=ensureSuccess(await api("/api/caepi/"+encodeURIComponent(ca)),"Não foi possível consultar este CA.");
    const item=result.body?.item;
    if(!item)throw new Error("A consulta não retornou os dados deste CA. Confira o número na consulta oficial.");
    if(item.ambiguous===true||item.autofillAllowed===false){
      message.className="message warn";
      message.textContent=item.warning||"Este CA possui registros divergentes na base consultada. Confirme os dados no portal do MTE antes do cadastro.";
      return;
    }
    if(item.found===false){message.className="message warn";message.textContent=item.warning||"CA não localizado na base consultada. A ausência não comprova que o CA inexiste; consulte o MTE.";return;}
    $("epiDescricao").value=item.description||item.name||"";
    $("epiFabricante").value=item.manufacturer||"";
    $("epiValidade").value=item.validity||"";
    $("epiSituacao").value=item.status||"Conferência necessária";
    if(item.officialSnapshot===true){
      const sourceDate=String(item.downloadedAt||item.sourceUpdatedAt||"");
      const timestamp=sourceDate.includes("T")?new Date(sourceDate):null;
      const readableDate=timestamp&&!Number.isNaN(timestamp.getTime())
        ? timestamp.toLocaleDateString("pt-BR")
        : window.JP_FICHA.formatDate(sourceDate);
      message.className="message success";
      message.textContent=item.warning||`Base oficial do MTE obtida${readableDate?" em "+readableDate:""}; confirme atualizações no portal.`;
      return;
    }
    const verified=item.verified===true && item.live===true;
    message.className="message "+(verified?"success":"warn");
    message.textContent=verified
      ? "Dados consultados. Confira a descrição do EPI antes de inserir no cadastro."
      : (item.warning||"Dados de base complementar, sem confirmação atual no MTE. Confira o CA na consulta oficial antes de inserir no cadastro.");
  }catch(error){if(error.code==="SESSION_CHANGED")return;message.className="message error";message.textContent=error.message;}
}
async function testBiometriaLocal(){
  const button=$("bioTestButton"),generation=sessionGeneration;if(button?.disabled)return;
  if(button)button.disabled=true;
  setStatusBadge("bioStatusBadge","Verificando","loading");setText("bioStatusTitle","Consultando o serviço local");
  setText("bioStatusText","Aguarde enquanto verificamos a resposta do serviço neste computador.");setText("bioOutput","Consultando JP Biometria local...");
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("http://127.0.0.1:8789/status",{signal:controller.signal});
    const text=await response.text();let body=text;try{body=JSON.parse(text);}catch(error){}
    if(generation!==sessionGeneration)return;
    setText("bioOutput",JSON.stringify({status:response.status,body},null,2));
    if(!response.ok)throw new Error("O serviço local respondeu com erro "+response.status+".");
    setStatusBadge("bioStatusBadge","Serviço acessível","success");setText("bioStatusTitle","O serviço local respondeu");
    setText("bioStatusText","A conexão com o serviço foi confirmada. Este teste não confirma a detecção do leitor, a captura ou a verificação de uma assinatura biométrica.");
  }catch(error){
    if(generation!==sessionGeneration)return;
    setStatusBadge("bioStatusBadge","Sem conexão","error");setText("bioStatusTitle","Não foi possível confirmar a conexão");
    setText("bioStatusText","Confira se o serviço JP Biometria está aberto neste computador e se o navegador permite o acesso local. Depois, tente novamente.");
    setText("bioOutput",error.name==="AbortError"?"O serviço local não respondeu em 8 segundos.":error.message);
  }finally{
    clearTimeout(timeout);
    if(generation===sessionGeneration){if(button)button.disabled=false;setText("bioCheckedAt","Última verificação: "+new Date().toLocaleString("pt-BR"));}
  }
}
function imprimirFicha(id){
  let documentUrl="";
  const releaseDocument=()=>{if(documentUrl){URL.revokeObjectURL(documentUrl);documentUrl="";}};
  try{
    const ficha=cache.fichas.find(item=>item.id===id);
    if(!ficha)throw new Error("Ficha não encontrada. Atualize a lista e tente novamente.");
    if(ficha.empresaId && String(ficha.empresaId)!==String(activeEmpresaId))throw new Error("Selecione a empresa desta ficha para imprimir.");
    const empresa=cache.empresas.find(item=>item.id===(ficha.empresaId||activeEmpresaId))||{};
    const trabalhador=cache.trabalhadores.find(item=>item.id===ficha.trabalhadorId)||{};
    const html=window.JP_FICHA.buildDocument(ficha,empresa,trabalhador,cache.epis,{defaultLogo:document.querySelector(".brand-logo")?.src});
    documentUrl=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}));
    // Navegar o documento permite ao navegador carregar imagens normalmente.
    const preview=window.open(documentUrl,"_blank","width=900,height=1120");
    if(!preview)throw new Error("Permita a abertura de novas janelas para visualizar e imprimir a ficha.");
    preview.opener=null;
    let finished=false;
    const finish=()=>{finished=true;clearTimeout(loadTimeout);releaseDocument();};
    const loadTimeout=setTimeout(()=>{
      if(finished)return;
      finish();
      if(!preview.closed)handleAppError(new Error("Não foi possível carregar a ficha para impressão. Confira a conexão e tente novamente."));
    },30000);
    preview.addEventListener("load",async()=>{
      if(finished||preview.closed){finish();return;}
      try{
        await Promise.all(Array.from(preview.document.images).map(img=>img.decode()));
        if(preview.document.fonts)await preview.document.fonts.ready;
        if(!finished&&!preview.closed){preview.focus();preview.print();}
      }catch(error){
        if(!finished)handleAppError(new Error("Não foi possível carregar o logotipo ou a imagem registrada na ficha. Confira o cadastro e tente novamente."));
      }finally{finish();}
    },{once:true});
  }catch(error){releaseDocument();handleAppError(error);}
}
function goScreen(screen){document.querySelector(`[data-screen="${screen}"]`)?.click()}
function showApp(){const auth=getAuth();if(!auth)return;$("loginPage").classList.add("hidden");$("appShell").classList.remove("hidden");$("userBadge").textContent=auth.username||"Usuário autenticado";renderConfigSummary();activateScreen("dashboard",false);refreshAll().catch(handleAppError)}
function showLogin(clearDrafts=false){clearSessionData(clearDrafts);if(clearDrafts)$("password").value="";$("appShell").classList.add("hidden");$("loginPage").classList.remove("hidden")}
$("empresaAtivaSelect").addEventListener("change",async e=>{activeEmpresaId=e.target.value;localStorage.setItem(activeCompanyKey,activeEmpresaId);await refreshAllSafe()});
$("togglePassword").addEventListener("click",()=>{const i=$("password");const show=i.type==="password";i.type=show?"text":"password";$("togglePassword").textContent=show?"Ocultar":"Mostrar"});
$("forgotLink").addEventListener("click",e=>{e.preventDefault();setMsg("warn","Recuperação de senha será tratada pelo administrador.")});
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();hideMsg();const username=$("username").value.trim();const password=$("password").value;if(!username||!password){setMsg("error","Informe usuário e senha.");return}$("loginButton").disabled=true;$("loginButton").textContent="Entrando...";try{const auth=await cognitoLogin(username,password);saveAuth(auth,username);if($("rememberUser").checked)localStorage.setItem(rememberedUserKey,username);else localStorage.removeItem(rememberedUserKey);setMsg("success","Login realizado com sucesso.");setTimeout(showApp,300)}catch(err){setMsg("error",err.message||"Usuário ou senha inválidos.")}finally{$("loginButton").disabled=false;$("loginButton").textContent="Entrar"}});
async function submitCadastro(event, path, empresaRequired=false) {
  event.preventDefault();
  if(empresaRequired&&!requireEmpresa())return;
  const form=event.target,button=form.querySelector('button[type="submit"]');
  if(button.disabled)return;
  button.disabled=true;clearAppError();
  try{
    const body=formDataObj(form);
    if(empresaRequired)body.empresaId=activeEmpresaId;
    const result=ensureSuccess(await api(path,{method:"POST",body:JSON.stringify(body)}),"Não foi possível salvar o cadastro.");
    if(path==="/api/empresas"&&result.body?.item){activeEmpresaId=result.body.item.id;localStorage.setItem(activeCompanyKey,activeEmpresaId);}
    form.reset();await refreshAll();
  }catch(error){handleAppError(error);}finally{button.disabled=false;}
}
$("empresaForm").addEventListener("submit",event=>submitCadastro(event,"/api/empresas"));
$("trabalhadorForm").addEventListener("submit",event=>submitCadastro(event,"/api/trabalhadores",true));
$("epiForm").addEventListener("submit",event=>submitCadastro(event,"/api/epis",true));
$("entregaForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!requireEmpresa())return;
  const form=event.target,button=form.querySelector('button[type="submit"]');
  if(button.disabled)return;
  button.disabled=true;clearAppError();
  try{
    const body=formDataObj(form);
    const empresa=cache.empresas.find(item=>item.id===activeEmpresaId)||{};
    const epi=cache.epis.find(item=>item.id===body.epiId);
    const trabalhador=cache.trabalhadores.find(item=>item.id===body.trabalhadorId);
    if(!trabalhador||!epi)throw new Error("Selecione o trabalhador e um EPI cadastrado para esta empresa.");
    const quantidade=Number(body.quantidade);
    if(!Number.isInteger(quantidade)||quantidade<1)throw new Error("Informe uma quantidade inteira maior que zero.");
    const payload={
      empresaId:activeEmpresaId,trabalhadorId:trabalhador.id,
      trabalhadorNome:trabalhador.nomeCompleto||trabalhador.nome||trabalhador.name,
      tipo:body.tipo,data:new Date().toLocaleDateString("pt-BR"),
      ...window.JP_FICHA.createSnapshot(empresa,trabalhador),
      itens:[{epiId:epi.id,epiDescricao:epi.descricao||epi.name,ca:epi.ca,quantidade}]
    };
    ensureSuccess(await api("/api/fichas",{method:"POST",body:JSON.stringify(payload)}),"Não foi possível gerar a ficha de EPI.");
    await refreshAll();goScreen("fichas");
  }catch(error){handleAppError(error);}finally{button.disabled=false;}
});
$("logoutButton").addEventListener("click",()=>{sessionStorage.removeItem(tokenKey);showLogin(true)});$("refreshButton").addEventListener("click",()=>refreshAllSafe());
document.querySelectorAll(".nav button").forEach(btn=>btn.addEventListener("click",()=>activateScreen(btn.dataset.screen)));
$("menuToggle")?.addEventListener("click",()=>setSidebarOpen(!$("appShell").classList.contains("sidebar-open"),true));
$("sidebarClose")?.addEventListener("click",()=>setSidebarOpen(false,true));
$("sidebarBackdrop")?.addEventListener("click",()=>setSidebarOpen(false,true));
document.addEventListener("keydown",event=>{
  if(!$("appShell").classList.contains("sidebar-open"))return;
  if(event.key==="Escape"){event.preventDefault();setSidebarOpen(false,true);return;}
  if(event.key==="Tab"){
    const controls=Array.from($("primarySidebar").querySelectorAll('button:not([disabled]),a[href],select:not([disabled]),input:not([disabled])'));
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
if(navigationMedia?.addEventListener)navigationMedia.addEventListener("change",()=>setSidebarOpen(false));
setSidebarOpen(false);
const remembered=localStorage.getItem(rememberedUserKey);if(remembered){$("username").value=remembered;$("rememberUser").checked=true}if(getAuth())showApp();
