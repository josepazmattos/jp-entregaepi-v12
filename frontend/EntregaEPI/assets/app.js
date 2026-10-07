(function ensureConfig(){if(!window.JP_CONFIG||!window.JP_CONFIG.apiBaseUrl){window.JP_CONFIG={version:"12.8.0",appBasePath:"/EntregaEPI/",apiBaseUrl:"https://g4pdu3t1va.execute-api.sa-east-1.amazonaws.com",cognitoRegion:"sa-east-1",userPoolId:"sa-east-1_3FNCoTvr0",clientId:"2q2inha617oeer4vb0m0hjoja0",ambiente:"producao"}}})();
const $=id=>document.getElementById(id), tokenKey="jp-v12-auth", rememberedUserKey="jp-v12-remembered-user", activeCompanyKey="jp-v12-active-company";
let sessionGeneration=0,companyGeneration=0,authAttempt=0,importAttempt=0,logoCreateGeneration=0,logoEditGeneration=0;let lastSessionUsername="";let cache={empresas:[],trabalhadores:[],epis:[],fichas:[]};let activeEmpresaId=sessionStorage.getItem(activeCompanyKey)||"";
let firstAccessChallenge=null,empresaLogoDraft="",empresaLogoEdit=null,empresaRequestId="",importPreview=null,companyLoginAutomatic=true;
let logoCreateLoading=false,companySaving=false;
const screenLabels={dashboard:"Dashboard",empresas:"Empresas",trabalhadores:"Trabalhadores",epis:"EPIs e CA",entrega:"Entrega de EPI",fichas:"Fichas de EPI",biometria:"Biometria",config:"Configurações"};
const navigationMedia=typeof window.matchMedia==="function"?window.matchMedia("(max-width: 1024px)"):null;
function setText(id,value){const node=$(id);if(node)node.textContent=value;}
function setStatusBadge(id,label,state){const node=$(id);if(node){node.textContent=label;node.dataset.state=state;}}
function currentGroups(){const raw=getAuth()?.payload?.["cognito:groups"];return Array.isArray(raw)?raw:typeof raw==="string"?raw.split(",").map(value=>value.trim()):[];}
function isMaster(){return currentGroups().includes("MASTER");}
function saveActiveCompany(id){activeEmpresaId=String(id||"");sessionStorage.setItem(activeCompanyKey,activeEmpresaId);localStorage.removeItem(activeCompanyKey);}
function renderRoleAccess(){
  const master=isMaster();
  document.querySelectorAll("[data-master-only]").forEach(node=>node.classList.toggle("hidden",!master));
  $("empresasColumns")?.classList.toggle("company-self",!master);
  if($("empresaAtivaSelect"))$("empresaAtivaSelect").disabled=!master;
  setText("companyShortcutTitle",master?"Nova empresa":"Minha empresa");
  setText("companyShortcutText",master?"Cadastre clientes e acessos":"Consulte dados e logotipo");
  setText("empresasIntro",master?"Cadastre empresas clientes, crie os acessos e acompanhe seus cadastros.":"Consulte os dados e o logotipo utilizados nas fichas da sua empresa.");
  setText("empresasListTitle",master?"Empresas cadastradas":"Minha empresa");
  setText("empresasListHelp",master?"Selecione a empresa em uso no topo da página.":"Este acesso está vinculado à sua empresa.");
}
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
async function cognitoRequest(operation,payload){
  const cfg=window.JP_CONFIG;
  const res=await fetch("https://cognito-idp."+cfg.cognitoRegion+".amazonaws.com/",{method:"POST",headers:{"Content-Type":"application/x-amz-json-1.1","X-Amz-Target":"AWSCognitoIdentityProviderService."+operation},body:JSON.stringify({ClientId:cfg.clientId,...payload})});
  const raw=await res.text();let data={};try{data=JSON.parse(raw);}catch(error){data={};}
  if(!res.ok){const error=new Error(data.message||"Não foi possível autenticar. Confira os dados e tente novamente.");error.code=String(data.__type||"").split("#").pop();throw error;}
  return data;
}
async function cognitoLogin(username,password){
  const authenticate=value=>cognitoRequest("InitiateAuth",{AuthFlow:"USER_PASSWORD_AUTH",AuthParameters:{USERNAME:username,PASSWORD:value}});
  let data;
  try{data=await authenticate(password);}catch(error){
    if(error.code!=="NotAuthorizedException"||!/^[a-z0-9]{8}$/i.test(password))throw error;
    // A senha provisória atende à política do pool sem alterar o código inicial entregue à empresa.
    data=await authenticate("JpEpi1-Inicial-"+password.toUpperCase());
  }
  if(data.ChallengeName&&data.ChallengeName!=="NEW_PASSWORD_REQUIRED")throw new Error("Este acesso exige uma verificação adicional. Solicite orientação ao administrador.");
  return data;
}
function resetFirstAccess(){
  firstAccessChallenge=null;$("newPasswordForm")?.classList.add("hidden");$("loginForm")?.classList.remove("hidden");
  ["newPassword","newPasswordConfirm"].forEach(id=>{if($(id))$(id).value="";});
  if($("newPasswordButton"))$("newPasswordButton").disabled=false;
  if($("loginButton")){$("loginButton").disabled=false;$("loginButton").textContent="Entrar";}
  setText("newPasswordUsername","");setText("newPasswordMessage","");$("newPasswordMessage")?.classList.add("hidden");
}
function beginFirstAccess(data,username){
  let required=[];try{required=JSON.parse(data.ChallengeParameters?.requiredAttributes||"[]");}catch(error){throw new Error("Não foi possível preparar o primeiro acesso. Entre novamente.");}
  if(!data.Session||required.length)throw new Error("O cadastro de acesso precisa ser completado pelo administrador antes da troca de senha.");
  firstAccessChallenge={session:data.Session,username,cognitoUsername:data.ChallengeParameters?.USER_ID_FOR_SRP||data.ChallengeParameters?.USERNAME||username};
  $("password").value="";hideMsg();$("loginForm").classList.add("hidden");$("newPasswordForm").classList.remove("hidden");
  setText("newPasswordUsername",username);$("newPassword")?.focus();
}
function rememberLogin(username){if($("rememberUser").checked)localStorage.setItem(rememberedUserKey,username);else localStorage.removeItem(rememberedUserKey);}
function finishLogin(authentication,username){
  if(!authentication?.IdToken)throw new Error("O serviço não confirmou a autenticação. Entre novamente.");
  saveAuth(authentication,username);rememberLogin(username);resetFirstAccess();$("password").value="";showApp();
}
async function api(path,opts={}){const requestSession=sessionGeneration,requestCompany=companyGeneration;const scoped=/^\/api\/(trabalhadores|fichas)(\/|$)|^\/api\/empresas\//.test(path);const cfg=window.JP_CONFIG;const auth=getAuth();const headers=Object.assign({},opts.headers||{});if(auth&&auth.idToken)headers.Authorization="Bearer "+auth.idToken;if(activeEmpresaId)headers["x-empresa-id"]=activeEmpresaId;if(opts.body&&!headers["content-type"])headers["content-type"]="application/json";let res;try{res=await fetch(cfg.apiBaseUrl+path,Object.assign({},opts,{headers}));}catch(error){if(requestSession!==sessionGeneration||(scoped&&requestCompany!==companyGeneration))error.code="SESSION_CHANGED";throw error;}const text=await res.text();let body=text;try{body=JSON.parse(text)}catch(e){}if(requestSession!==sessionGeneration||(scoped&&requestCompany!==companyGeneration)){const error=new Error("A sessão ou a empresa mudou durante a consulta.");error.code="SESSION_CHANGED";throw error;}return {status:res.status,body}}
function write(data){$("apiOutput").textContent=typeof data==="string"?data:JSON.stringify(data,null,2)}function asArray(resp){return resp&&resp.body&&Array.isArray(resp.body.items)?resp.body.items:[]}function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function ensureSuccess(result, fallback="Não foi possível concluir a operação.") {
  if (result.status < 200 || result.status >= 300 || result.body?.ok === false) {
    const message = result.body?.error || result.body?.message || fallback;
    const error = new Error(typeof message === "string" ? message : fallback);
    error.status = result.status;
    error.code = result.body?.code;
    error.responseBody = result.body;
    throw error;
  }
  return result;
}
function clearSessionData(clearDrafts=false) {
  sessionGeneration++;companyGeneration++;authAttempt++;logoCreateGeneration++;logoEditGeneration++;
  if(logoCreateLoading&&$("empresaLogoFile"))$("empresaLogoFile").value="";
  logoCreateLoading=false;companySaving=false;updateCompanySubmitButton();
  ["trabalhadorForm","epiForm","entregaForm","empresaAccessForm"].forEach(id=>{const button=$(id)?.querySelector('button[type="submit"]');if(button)button.disabled=false;});
  cache={empresas:[],trabalhadores:[],epis:[],fichas:[]};
  activeEmpresaId="";localStorage.removeItem(activeCompanyKey);sessionStorage.removeItem(activeCompanyKey);
  ["empresasList","trabalhadoresList","episList","fichasList","dashboardFichas","nextActions"].forEach(id=>$(id).textContent="");
  ["metricEmpresas","metricTrabalhadores","metricEpis","metricFichas"].forEach(id=>$(id).textContent=0);
  $("empresaAtivaSelect").innerHTML='<option value="">Selecione uma empresa</option>';
  $("userBadge").textContent="Usuário autenticado";
  resetDiagnostics();renderConfigSummary();setSidebarOpen(false);renderRoleAccess();resetFirstAccess();clearCredentials();clearImportPreview();resetCompanyLogoEditor();
  clearAppError();renderEntregaOptions();$("caMessage").className="message hidden";$("caMessage").textContent="";
  if(clearDrafts){["empresaForm","trabalhadorForm","epiForm","entregaForm"].forEach(id=>$(id).reset());empresaLogoDraft="";empresaRequestId="";companyLoginAutomatic=true;setLogoPreview("empresaLogoPreview","empresaLogoPreviewWrap","");updateEquipmentKind();}
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
    cache.trabalhadores=[];cache.fichas=[];
    $("trabalhadoresList").textContent="Selecione uma empresa.";
    $("fichasList").textContent="Selecione uma empresa.";
    await refreshEpis(false);
    renderEntregaOptions();
  }
  $("metricEmpresas").textContent=cache.empresas.length;
  $("metricTrabalhadores").textContent=cache.trabalhadores.length;
  $("metricEpis").textContent=cache.epis.length;
  $("metricFichas").textContent=cache.fichas.length;
  renderDashboard();
  renderConfigSummary();
  await restoreImportPreview();
}
function renderDashboard(){const banner=$("actionBanner");if(!activeEmpresaId&&isMaster()){banner.classList.remove("hidden")}else banner.classList.add("hidden");const actions=[];if(!cache.empresas.length)actions.push(isMaster()?"Cadastre a primeira empresa cliente.":"Solicite ao administrador a vinculação deste acesso à sua empresa.");if(activeEmpresaId&&!cache.trabalhadores.length)actions.push("Cadastre trabalhadores ou importe a equipe pelo Excel.");if(activeEmpresaId&&!cache.epis.length)actions.push("Cadastre equipamentos no catálogo compartilhado.");if(activeEmpresaId&&cache.trabalhadores.length&&cache.epis.length)actions.push("Gere uma ficha de EPI.");$("nextActions").innerHTML=actions.length?actions.map(a=>`<div class="item"><strong>${escapeHtml(a)}</strong></div>`).join(""):'<div class="item"><strong>Fluxo inicial concluído.</strong><small>Você já pode gerar e acompanhar fichas de EPI.</small></div>';$("dashboardFichas").innerHTML=cache.fichas.length?cache.fichas.slice(0,6).map(f=>itemHtml(f,[f.trabalhadorNome||f.trabalhadorId,f.tipo,f.status,f.data])).join(""):"Nenhuma ficha gerada para a empresa selecionada."}
async function refreshEmpresas(update=true){const r=await api("/api/empresas");ensureSuccess(r,"Não foi possível carregar as empresas.");cache.empresas=asArray(r);renderEmpresas();if(update)await refreshAllSafe();return r}
function renderEmpresas(){
  const el=$("empresasList"),sel=$("empresaAtivaSelect");if(!el||!sel)return;sel.innerHTML='<option value="">Selecione uma empresa</option>';
  if(!cache.empresas.some(e=>String(e.id)===String(activeEmpresaId))){companyGeneration++;clearImportPreview();saveActiveCompany(cache.empresas[0]?.id||"");}
  renderRoleAccess();renderCompanyLogoEditor();
  if(!cache.empresas.length){el.textContent="Nenhuma empresa cadastrada.";return;}
  el.innerHTML=cache.empresas.map(e=>{
    const pending=isMaster()&&e.acessoStatus==="pendente";
    const actions=pending?`<div class="item-actions"><button class="btn btn-secondary" type="button" data-empresa-id="${escapeHtml(e.id)}" onclick="resumeCompanyAccess(this)">Retomar acesso</button></div>`:"";
    return itemHtml(e,[e.cnpj,e.localidade,e.login?"Login: "+e.login:"",e.acessoStatus==="pendente"?"Acesso pendente de criação":e.acessoStatus==="ativo"?"Acesso da empresa criado":e.status],actions);
  }).join("");
  cache.empresas.forEach(e=>{const o=document.createElement("option");o.value=e.id;o.textContent=e.nome||"Empresa";if(String(e.id)===String(activeEmpresaId))o.selected=true;sel.appendChild(o);});
}
function normalizeSearch(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim();}
function alphabetical(items,key){return [...items].sort((left,right)=>String(key(left)||"").localeCompare(String(key(right)||""),"pt-BR",{sensitivity:"base",numeric:true}));}
function renderTrabalhadores(){
  const search=normalizeSearch($("trabalhadorSearch")?.value),numeric=/^[\d.\-\s]+$/.test(search)?search.replace(/\D/g,""):"";const rows=cache.trabalhadores.filter(item=>!search||normalizeSearch([item.nomeCompleto||item.nome,item.cpf,item.matriculaESocial].join(" ")).includes(search)||(numeric&&String(item.cpf||"").replace(/\D/g,"").includes(numeric)));
  $("trabalhadoresList").innerHTML=rows.length?rows.map(t=>itemHtml(t,[t.cpf,t.funcao,t.matriculaESocial?"Matrícula eSocial: "+t.matriculaESocial:"",t.status])).join(""):search?"Nenhum trabalhador corresponde à busca.":"Nenhum trabalhador cadastrado.";
}
async function refreshTrabalhadores(update=true){if(!activeEmpresaId){$("trabalhadoresList").textContent="Selecione uma empresa.";return;}const r=await api("/api/trabalhadores");ensureSuccess(r,"Não foi possível carregar os trabalhadores.");cache.trabalhadores=alphabetical(asArray(r),t=>t.nomeCompleto||t.nome||t.name);renderTrabalhadores();renderEntregaOptions();if(update)await refreshAllSafe();return r;}
function isWithoutCA(item){return item.tipo==="sem_ca"||item.semCA===true;}
function equipmentLabel(item){return isWithoutCA(item)?"Sem CA":"CA "+(item.ca||"não informado");}
function equipmentDescription(item){return [item.descricao||item.name||"Equipamento",item.modelo?"Modelo: "+item.modelo:"",item.tamanho?"Tamanho: "+item.tamanho:""].filter(Boolean).join(" · ");}
function renderEpis(){
  const search=normalizeSearch($("epiSearch")?.value);const rows=cache.epis.filter(item=>!search||normalizeSearch([item.descricao||item.name,item.fabricante,item.ca,item.modelo,item.tamanho,equipmentLabel(item)].join(" ")).includes(search));
  $("episList").innerHTML=rows.length?rows.map(e=>itemHtml(e,[equipmentLabel(e),e.fabricante,[e.modelo?"Modelo: "+e.modelo:"",e.tamanho?"Tamanho: "+e.tamanho:""].filter(Boolean).join(" · "),isWithoutCA(e)?"":e.validade||e.validity,isWithoutCA(e)?"Equipamento sem Certificado de Aprovação":e.situacao||e.status])).join(""):search?"Nenhum equipamento corresponde à busca.":"Nenhum equipamento cadastrado no catálogo compartilhado.";
}
async function refreshEpis(update=true){const r=await api("/api/epis");ensureSuccess(r,"Não foi possível carregar o catálogo de equipamentos.");cache.epis=alphabetical(asArray(r),e=>e.descricao||e.name);renderEpis();renderEntregaOptions();if(update)await refreshAllSafe();return r;}
async function refreshFichas(update=true){if(!activeEmpresaId){$("fichasList").textContent="Selecione uma empresa.";return}const r=await api("/api/fichas");ensureSuccess(r,"Não foi possível carregar as fichas.");cache.fichas=asArray(r);$("fichasList").innerHTML=cache.fichas.length?cache.fichas.map(f=>itemHtml(f,[f.trabalhadorNome||f.trabalhadorId,f.tipo,f.status,f.data],`<div style="margin-top:10px"><button class="btn btn-secondary" data-ficha-id="${escapeHtml(f.id)}" onclick="imprimirFicha(this.dataset.fichaId)">Visualizar/Imprimir</button></div>`)).join(""):"Nenhuma ficha cadastrada.";if(update)await refreshAllSafe();return r}
async function refreshAllSafe(){try{await refreshAll()}catch(error){handleAppError(error)}}
function renderEntregaOptions(){const tsel=$("entregaTrabalhador"),esel=$("entregaEpi");if(tsel)tsel.innerHTML=cache.trabalhadores.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.nomeCompleto||t.nome||"Trabalhador")}</option>`).join("");if(esel)esel.innerHTML=cache.epis.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(equipmentDescription(e)+" - "+equipmentLabel(e))}</option>`).join("");}
function updateEquipmentKind(){
  const without=$("epiSemCa")?.checked===true;
  $("epiCaFields")?.classList.toggle("hidden",without);$("epiCaDetails")?.classList.toggle("hidden",without);$("epiSemCaHelp")?.classList.toggle("hidden",!without);
  ["caInput","epiValidade","epiSituacao"].forEach(id=>{const input=$(id);if(input){input.disabled=without;if(without)input.value="";}});
  if($("caInput"))$("caInput").required=!without;
  if($("consultarCaButton"))$("consultarCaButton").disabled=without;
  $("caMessage").className="message hidden";$("caMessage").textContent="";
}
function normalizedCnpj(value){return String(value||"").replace(/[^a-z0-9]/gi,"").toUpperCase();}
function createRequestId(){if(window.crypto?.randomUUID)return window.crypto.randomUUID();throw new Error("Este navegador precisa ser atualizado para concluir o cadastro.");}
function updateCompanySubmitButton(){const button=$("empresaForm")?.querySelector('button[type="submit"]');if(button)button.disabled=logoCreateLoading||companySaving;}
function clearCredentials(){
  $("empresaCredentialsPanel")?.classList.add("hidden");
  ["empresaCredentialsLogin","empresaCredentialsPassword"].forEach(id=>{if($(id))$(id).value="";});
  if($("empresaCredentialsPassword"))$("empresaCredentialsPassword").type="password";
  setText("empresaCredentialsToggle","Mostrar");
}
function showCompanyAccess(result,cnpj){
  clearCredentials();
  if(result.body?.acesso?.status!=="ativo"){
    $("appMessage").className="message warn";$("appMessage").textContent=result.body?.warning||"Empresa salva. A criação do acesso está pendente; use Retomar acesso.";return;
  }
  $("empresaCredentialsLogin").value=result.body.acesso.login||result.body.item?.login||"";
  $("empresaCredentialsPassword").value=normalizedCnpj(cnpj||result.body.item?.cnpj).slice(0,8);
  $("empresaCredentialsPanel").classList.remove("hidden");
}
function setLogoPreview(imageId,wrapId,value){
  const image=$(imageId),wrap=$(wrapId);if(!image||!wrap)return;
  if(value){image.src=value;image.classList.remove("hidden");wrap.classList.remove("hidden");}
  else{image.removeAttribute("src");image.classList.add("hidden");if(wrapId==="empresaLogoPreviewWrap")wrap.classList.add("hidden");}
}
function fileAsDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(new Error("Não foi possível ler o arquivo selecionado."));reader.readAsDataURL(file);});}
async function normalizeLogo(file){
  if(!file||!["image/png","image/jpeg"].includes(file.type))throw new Error("Escolha um logotipo em PNG ou JPG.");
  if(file.size>2*1024*1024)throw new Error("O logotipo deve ter até 2 MB. Escolha uma imagem menor.");
  const source=await fileAsDataUrl(file),image=new Image();image.src=source;
  try{await image.decode();}catch(error){throw new Error("O arquivo não pôde ser lido como imagem. Escolha outro PNG ou JPG.");}
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>24000000)throw new Error("As dimensões da imagem são muito grandes. Escolha uma versão menor do logotipo.");
  let factor=Math.min(1,600/image.naturalWidth,300/image.naturalHeight),quality=.86;
  const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
  if(!context)throw new Error("O navegador não conseguiu preparar o logotipo.");
  for(let attempt=0;attempt<10;attempt++){
    canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));
    context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const value=canvas.toDataURL(file.type,quality),encoded=value.split(",")[1]||"";
    if(Math.ceil(encoded.length*3/4)<=48*1024)return value;
    if(file.type==="image/jpeg"&&quality>.55)quality-=.15;else factor*=.78;
  }
  throw new Error("Não foi possível ajustar o logotipo ao tamanho da ficha. Escolha uma imagem mais simples.");
}
function resetCompanyLogoEditor(){
  empresaLogoEdit=null;
  if($("empresaAccessForm"))$("empresaAccessForm").dataset.requestId="";
  if($("empresaLogoAtualFile"))$("empresaLogoAtualFile").value="";
  if($("empresaLogoSave"))$("empresaLogoSave").disabled=true;
  $("empresaLogoForm")?.classList.add("hidden");$("empresaAccessForm")?.classList.add("hidden");
  setLogoPreview("empresaLogoAtualPreview","empresaLogoAtualPreviewWrap","");
  setText("empresaLogoCompany","Selecione a empresa para atualizar o logotipo.");
}
function renderCompanyLogoEditor(){
  const empresa=cache.empresas.find(item=>String(item.id)===String(activeEmpresaId));
  if(!empresa){resetCompanyLogoEditor();return;}
  $("empresaLogoForm")?.classList.remove("hidden");setText("empresaLogoCompany",empresa.nome||"Empresa selecionada");
  if(empresaLogoEdit===null){
    const logo=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(empresa.logoDataUrl||""))?empresa.logoDataUrl:"";
    setLogoPreview("empresaLogoAtualPreview","empresaLogoAtualPreviewWrap",logo);$("empresaLogoEmpty")?.classList.toggle("hidden",Boolean(logo));
    if($("empresaLogoAtualRemove"))$("empresaLogoAtualRemove").disabled=!logo;
  }
  const needsAccess=isMaster()&&!empresa.acessoStatus;
  $("empresaAccessForm")?.classList.toggle("hidden",!needsAccess);
  if(needsAccess){
    setText("empresaAccessCompany",empresa.nome||"Empresa selecionada");
    $("empresaAccessCnpj").value=empresa.cnpj||"";$("empresaAccessLogin").value=empresa.login||normalizedCnpj(empresa.cnpj).toLowerCase();
  }
}
async function selectLogo(event,editing){
  const file=event.target.files?.[0];if(!file)return;
  const attempt=editing?++logoEditGeneration:++logoCreateGeneration,generation=sessionGeneration,company=companyGeneration;
  const current=()=>attempt===(editing?logoEditGeneration:logoCreateGeneration)&&generation===sessionGeneration&&(!editing||company===companyGeneration);
  if(editing)$("empresaLogoSave").disabled=true;
  else{logoCreateLoading=true;updateCompanySubmitButton();}
  try{
    const value=await normalizeLogo(file);
    if(!current())return;
    if(editing){empresaLogoEdit=value;setLogoPreview("empresaLogoAtualPreview","empresaLogoAtualPreviewWrap",value);$("empresaLogoEmpty").classList.add("hidden");$("empresaLogoSave").disabled=false;$("empresaLogoAtualRemove").disabled=false;}
    else{empresaLogoDraft=value;empresaRequestId="";setLogoPreview("empresaLogoPreview","empresaLogoPreviewWrap",value);}
  }catch(error){
    if(!current())return;
    event.target.value="";if(editing)$("empresaLogoSave").disabled=empresaLogoEdit===null;handleAppError(error);
  }finally{if(!editing&&current()){logoCreateLoading=false;updateCompanySubmitButton();}}
}
async function submitCompany(event){
  event.preventDefault();if(!isMaster()){handleAppError(new Error("O cadastro de empresas e acessos é realizado pelo Master."));return;}
  const form=event.target,button=form.querySelector('button[type="submit"]'),generation=sessionGeneration;if(button.disabled||logoCreateLoading)return;companySaving=true;updateCompanySubmitButton();clearAppError();clearCredentials();
  try{
    const body=formDataObj(form);body.logoDataUrl=empresaLogoDraft;
    if(!empresaRequestId)empresaRequestId=createRequestId();body.requestId=empresaRequestId;
    const result=ensureSuccess(await api("/api/empresas",{method:"POST",body:JSON.stringify(body)}),"Não foi possível cadastrar a empresa.");
    if(!result.body?.item?.id)throw new Error("O serviço não confirmou o cadastro da empresa. Tente novamente.");
    companyGeneration++;const selectedGeneration=companyGeneration;clearImportPreview();resetCompanyLogoEditor();saveActiveCompany(result.body.item.id);
    form.reset();empresaRequestId="";empresaLogoDraft="";companyLoginAutomatic=true;setLogoPreview("empresaLogoPreview","empresaLogoPreviewWrap","");
    await refreshAll();if(generation!==sessionGeneration||selectedGeneration!==companyGeneration)return;showCompanyAccess(result,body.cnpj);
  }catch(error){if(generation===sessionGeneration)handleAppError(error);}finally{if(generation===sessionGeneration){companySaving=false;updateCompanySubmitButton();}}
}
async function resumeCompanyAccess(button){
  if(!isMaster()||button.disabled)return;const empresa=cache.empresas.find(item=>String(item.id)===String(button.dataset.empresaId));if(!empresa)return;
  const generation=sessionGeneration,company=companyGeneration;
  button.disabled=true;clearCredentials();clearAppError();
  try{const result=ensureSuccess(await api("/api/empresas/"+encodeURIComponent(empresa.id)+"/acesso",{method:"POST",body:"{}"}));await refreshEmpresas(false);if(generation!==sessionGeneration||company!==companyGeneration)return;showCompanyAccess(result,empresa.cnpj);}
  catch(error){if(generation===sessionGeneration&&company===companyGeneration)handleAppError(error);}finally{button.disabled=false;}
}
async function submitExistingCompanyAccess(event){
  event.preventDefault();if(!isMaster()||!activeEmpresaId)return;
  const form=event.target,button=form.querySelector('button[type="submit"]'),generation=sessionGeneration,company=companyGeneration;if(button.disabled)return;button.disabled=true;clearCredentials();clearAppError();
  try{
    const body=formDataObj(form);if(!form.dataset.requestId)form.dataset.requestId=createRequestId();body.requestId=form.dataset.requestId;
    const result=ensureSuccess(await api("/api/empresas/"+encodeURIComponent(activeEmpresaId)+"/acesso",{method:"POST",body:JSON.stringify(body)}));
    form.dataset.requestId="";await refreshEmpresas(false);if(generation!==sessionGeneration||company!==companyGeneration)return;showCompanyAccess(result,body.cnpj);
  }catch(error){if(generation===sessionGeneration&&company===companyGeneration)handleAppError(error);}finally{button.disabled=false;}
}
async function submitCompanyLogo(event){
  event.preventDefault();if(!requireEmpresa()||empresaLogoEdit===null)return;
  const button=$("empresaLogoSave"),generation=sessionGeneration,selectedGeneration=companyGeneration;if(button.disabled)return;button.disabled=true;clearAppError();
  try{
    const company=cache.empresas.find(item=>String(item.id)===String(activeEmpresaId));
    ensureSuccess(await api("/api/empresas/"+encodeURIComponent(activeEmpresaId),{method:"PATCH",body:JSON.stringify({logoDataUrl:empresaLogoEdit,...(company?._version!==undefined?{_version:company._version}:{})})}));
    empresaLogoEdit=null;$("empresaLogoAtualFile").value="";await refreshEmpresas(false);if(generation!==sessionGeneration||selectedGeneration!==companyGeneration)return;$("appMessage").className="message success";$("appMessage").textContent="Logotipo atualizado para as novas fichas de EPI.";
  }catch(error){if(generation===sessionGeneration&&selectedGeneration===companyGeneration)handleAppError(error);}finally{if(generation===sessionGeneration&&selectedGeneration===companyGeneration)button.disabled=empresaLogoEdit===null;}
}
function setImportMessage(type,message){const element=$("trabalhadoresImportMessage");if(element){element.className="message "+type;element.textContent=message;}}
function importReferenceKey(){const auth=getAuth(),identity=auth?.payload?.sub||auth?.username;return identity&&activeEmpresaId?"jp-v12-importacao:"+encodeURIComponent(identity)+":"+encodeURIComponent(activeEmpresaId):"";}
function clearImportReference(){const key=importReferenceKey();if(key)sessionStorage.removeItem(key);}
function saveImportReference(report){
  const key=importReferenceKey();if(!key)return;
  if(["concluida","sem_alteracoes","invalida","conflito","expirada"].includes(report.status)){sessionStorage.removeItem(key);return;}
  sessionStorage.setItem(key,JSON.stringify({importacaoId:report.importacaoId,expiresAt:report.expiresAt}));
}
function clearImportPreview(){
  importAttempt++;importPreview=null;
  $("trabalhadoresImportPreview")?.classList.add("hidden");
  setText("trabalhadoresImportRows","");setText("trabalhadoresImportSummary","");setText("trabalhadoresImportContext","");
  setText("trabalhadoresImportMessage","");$("trabalhadoresImportMessage")?.classList.add("hidden");
  if($("trabalhadoresImportFile")){$("trabalhadoresImportFile").value="";$("trabalhadoresImportFile").disabled=false;}
  if($("trabalhadoresImportCommit")){$("trabalhadoresImportCommit").disabled=true;$("trabalhadoresImportCommit").textContent="Sincronizar trabalhadores";}
  if($("trabalhadoresImportCancel"))$("trabalhadoresImportCancel").disabled=false;
}
function importReport(value){return value?.importacao||value?.item||value;}
function renderImportPreview(report){
  if(!report?.importacaoId||!Array.isArray(report.linhas))throw new Error("O serviço não retornou uma prévia válida. Envie a planilha novamente.");
  importPreview={...report,empresaId:activeEmpresaId};saveImportReference(report);
  const company=cache.empresas.find(item=>String(item.id)===String(activeEmpresaId));
  const progress=report.status==="em_andamento"?` · ${Number(report.processados)||0} de ${Number(report.total)||0} processados`:"";
  setText("trabalhadoresImportContext",[company?.nome||"Empresa selecionada",report.arquivoNome||"Planilha enviada"].join(" · ")+progress);
  const summary=report.resumo||{};
  $("trabalhadoresImportSummary").innerHTML=[["criar","Novos"],["atualizar","Atualizações"],["inalterados","Sem alteração"],["erros","Erros"]].map(([key,label])=>`<div class="import-stat${key==="erros"&&summary[key]>0?" has-errors":""}"><strong>${Number(summary[key])||0}</strong><span>${label}</span></div>`).join("");
  const labels={criar:"Incluir",atualizar:"Atualizar",inalterado:"Manter",erro:"Corrigir"};
  const fieldLabels={nomeCompleto:"Nome completo",cpf:"CPF",matriculaESocial:"Matrícula eSocial",funcao:"Função",localidade:"Localidade",setor:"Setor",dataAdmissao:"Data de admissão",rg:"RG",email:"E-mail",telefone:"Telefone",status:"Status",observacoes:"Observações"};
  $("trabalhadoresImportRows").innerHTML=report.linhas.map(row=>{
    const errors=Array.isArray(row.erros)?row.erros:[],changed=Array.isArray(row.camposAlterados)?row.camposAlterados:[];
    const detail=errors.length?errors.join(" "):changed.length?"Atualizar: "+changed.map(key=>fieldLabels[key]||key).join(", "):row.acao==="criar"?"Novo cadastro validado":row.acao==="inalterado"?"Cadastro preservado":"Pronto para sincronizar";
    return `<tr${row.acao==="erro"?' class="row-error"':""}><td>${escapeHtml(row.linha)}</td><td>${escapeHtml(row.nomeCompleto||"—")}</td><td>${escapeHtml(labels[row.acao]||row.acao||"Conferir")}</td><td>${escapeHtml(detail)}</td></tr>`;
  }).join("");
  $("trabalhadoresImportPreview").classList.remove("hidden");$("trabalhadoresImportCommit").disabled=report.podeConfirmar!==true;
  $("trabalhadoresImportCommit").textContent=report.status==="em_andamento"?"Continuar sincronização":"Sincronizar trabalhadores";
  if(report.status==="concluida")setImportMessage("success","Sincronização concluída. A relação de trabalhadores foi atualizada em ordem alfabética.");
  else if(report.status==="sem_alteracoes")setImportMessage("success","A planilha já corresponde aos cadastros. Nenhuma alteração é necessária.");
  else if(summary.erros>0||report.status==="invalida")setImportMessage("warn","Há linhas que precisam de correção. Ajuste a planilha e envie novamente; nenhum cadastro será alterado nesta prévia.");
  else if(report.status==="conflito")setImportMessage("warn","Algum cadastro mudou desde a prévia. Os lotes já concluídos foram preservados. Envie a planilha novamente para conferir as alterações restantes.");
  else if(report.status==="expirada")setImportMessage("warn","Esta prévia expirou. Os lotes já concluídos foram preservados. Envie a planilha novamente para conferir os cadastros atuais.");
  else if(report.status==="em_andamento")setImportMessage("warn","A sincronização foi iniciada. Continue para processar as linhas restantes.");
  else setImportMessage("success","Planilha conferida. Revise a prévia e clique em Sincronizar trabalhadores para aplicar as alterações.");
}
async function previewWorkersFile(event){
  const file=event.target.files?.[0];if(!file)return;if(!requireEmpresa()){event.target.value="";return;}
  clearImportPreview();const attempt=importAttempt,generation=sessionGeneration,company=companyGeneration;
  $("trabalhadoresImportFile").disabled=true;
  try{
    if(!/\.xlsx$/i.test(file.name))throw new Error("Envie a planilha no formato Excel .xlsx, usando o modelo disponível.");
    if(file.size>512*1024)throw new Error("A planilha deve ter até 512 KB e 500 trabalhadores. Use o modelo sem imagens ou outras abas de dados.");
    setImportMessage("warn","Lendo e conferindo a planilha. Aguarde a prévia da sincronização.");
    const dataUrl=await fileAsDataUrl(file);
    if(attempt!==importAttempt||generation!==sessionGeneration||company!==companyGeneration)return;
    const result=ensureSuccess(await api("/api/trabalhadores/importacao/previa",{method:"POST",body:JSON.stringify({arquivoNome:file.name,arquivoBase64:dataUrl.split(",")[1]||""})}),"Não foi possível conferir a planilha.");
    if(attempt!==importAttempt)return;
    renderImportPreview(importReport(result.body));
  }catch(error){
    if(attempt!==importAttempt||generation!==sessionGeneration||company!==companyGeneration||error.code==="SESSION_CHANGED")return;
    if(error.status===401){handleAppError(error);return;}setImportMessage("error",error.message||"Não foi possível conferir a planilha.");
  }finally{if(attempt===importAttempt&&generation===sessionGeneration&&company===companyGeneration)$("trabalhadoresImportFile").disabled=false;}
}
async function restoreImportPreview(){
  if(importPreview||!activeEmpresaId)return;
  const key=importReferenceKey();if(!key)return;
  let reference;try{reference=JSON.parse(sessionStorage.getItem(key)||"null");}catch(error){sessionStorage.removeItem(key);return;}
  if(!reference?.importacaoId)return;
  if(reference.expiresAt&&new Date(reference.expiresAt).getTime()<Date.now()){sessionStorage.removeItem(key);return;}
  const attempt=importAttempt;
  try{
    const result=ensureSuccess(await api("/api/trabalhadores/importacao/"+encodeURIComponent(reference.importacaoId)));
    if(attempt!==importAttempt)return;renderImportPreview(importReport(result.body));
  }catch(error){if(error.code==="SESSION_CHANGED"||attempt!==importAttempt)return;if([404,410].includes(error.status))sessionStorage.removeItem(key);else if(error.status===401)handleAppError(error);else setImportMessage("warn","Não foi possível recuperar a prévia pendente. Clique em Atualizar trabalhadores para tentar novamente.");}
}
async function confirmWorkersImport(){
  if(!importPreview||importPreview.podeConfirmar!==true||String(importPreview.empresaId)!==String(activeEmpresaId))return;
  const button=$("trabalhadoresImportCommit");if(button.disabled)return;
  const attempt=importAttempt,generation=sessionGeneration,company=companyGeneration,id=importPreview.importacaoId;
  button.disabled=true;$("trabalhadoresImportFile").disabled=true;$("trabalhadoresImportCancel").disabled=true;
  try{
    let count=0;
    while(count++<10){
      if(attempt!==importAttempt||generation!==sessionGeneration||company!==companyGeneration)return;
      const result=ensureSuccess(await api("/api/trabalhadores/importacao/"+encodeURIComponent(id)+"/confirmar",{method:"POST",body:"{}"}),"Não foi possível concluir a sincronização.");
      if(attempt!==importAttempt)return;
      const report=importReport(result.body);renderImportPreview(report);button.disabled=true;
      if(report.status==="concluida"||report.status==="sem_alteracoes"){
        clearImportReference();await refreshTrabalhadores(false);$("metricTrabalhadores").textContent=cache.trabalhadores.length;renderDashboard();return;
      }
      if(report.podeConfirmar!==true)return;
      button.textContent="Sincronizando "+(Number(report.processados)||0)+" de "+(Number(report.total)||0);
      setImportMessage("warn","Sincronização em andamento. Os lotes concluídos ficam salvos e podem ser retomados se a conexão for interrompida.");
    }
    throw new Error("A sincronização ainda possui linhas pendentes. Clique em Continuar sincronização para retomar.");
  }catch(error){
    if(attempt!==importAttempt||generation!==sessionGeneration||company!==companyGeneration||error.code==="SESSION_CHANGED")return;
    if(error.status===401){handleAppError(error);return;}
    const report=error.responseBody?.importacao;
    if(report)renderImportPreview(report);
    else{
      try{const result=ensureSuccess(await api("/api/trabalhadores/importacao/"+encodeURIComponent(id)));if(attempt!==importAttempt)return;renderImportPreview(importReport(result.body));}catch(recoveryError){if(recoveryError.code==="SESSION_CHANGED"||attempt!==importAttempt)return;if(recoveryError.status===401){handleAppError(recoveryError);return;}}
      if(importPreview?.status!=="concluida")setImportMessage("warn","A sincronização foi interrompida. Confira o progresso e clique em Continuar sincronização para retomar sem duplicar os cadastros.");
    }
    if(importPreview?.status==="concluida"||importPreview?.status==="conflito"){await refreshTrabalhadores(false);$("metricTrabalhadores").textContent=cache.trabalhadores.length;renderDashboard();}
  }finally{
    if(attempt===importAttempt&&generation===sessionGeneration&&company===companyGeneration){button.disabled=importPreview?.podeConfirmar!==true;button.textContent=importPreview?.status==="em_andamento"?"Continuar sincronização":"Sincronizar trabalhadores";$("trabalhadoresImportFile").disabled=false;$("trabalhadoresImportCancel").disabled=false;}
  }
}
function downloadWorkersTemplate(){
  const anchor=document.createElement("a");anchor.href=(window.JP_CONFIG.appBasePath||"/EntregaEPI/").replace(/\/?$/, "/")+"assets/modelo-trabalhadores.xlsx";anchor.download="Modelo_Trabalhadores_JP_EntregaEPI.xlsx";document.body.appendChild(anchor);anchor.click();anchor.remove();
}
async function consultarCA(){
  if($("epiSemCa")?.checked)return;
  const equipmentMode=$("epiComCa")?.checked;
  const ca=$("caInput").value.trim();
  const message=$("caMessage");
  if(!ca){message.className="message warn";message.textContent="Informe o número do CA.";return;}
  ["epiDescricao","epiFabricante","epiValidade","epiSituacao"].forEach(id=>$(id).value="");
  message.className="message warn";message.textContent="Consultando CA...";
  try{
    const result=ensureSuccess(await api("/api/caepi/"+encodeURIComponent(ca)),"Não foi possível consultar este CA.");
    if($("epiSemCa")?.checked||$("caInput").value.trim()!==ca||equipmentMode!==$("epiComCa")?.checked)return;
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
function showApp(){const auth=getAuth();if(!auth)return;$("loginPage").classList.add("hidden");$("appShell").classList.remove("hidden");$("userBadge").textContent=auth.username||"Usuário autenticado";renderConfigSummary();renderRoleAccess();activateScreen("dashboard",false);refreshAll().catch(handleAppError)}
function showLogin(clearDrafts=false){clearSessionData(clearDrafts);if(clearDrafts)$("password").value="";$("appShell").classList.add("hidden");$("loginPage").classList.remove("hidden")}
$("empresaAtivaSelect").addEventListener("change",async e=>{
  if(!isMaster()){renderEmpresas();return;}
  companyGeneration++;logoEditGeneration++;clearCredentials();clearImportPreview();resetCompanyLogoEditor();
  ["trabalhadorForm","entregaForm"].forEach(id=>{$(id).reset();const button=$(id).querySelector('button[type="submit"]');if(button)button.disabled=false;});if($("trabalhadorSearch"))$("trabalhadorSearch").value="";
  cache.trabalhadores=[];cache.fichas=[];$("trabalhadoresList").textContent="Carregando...";$("fichasList").textContent="Carregando...";$("dashboardFichas").textContent="";renderEntregaOptions();
  saveActiveCompany(e.target.value);await refreshAllSafe();
});
$("togglePassword").addEventListener("click",()=>{const i=$("password");const show=i.type==="password";i.type=show?"text":"password";$("togglePassword").textContent=show?"Ocultar":"Mostrar"});
$("forgotLink").addEventListener("click",e=>{e.preventDefault();setMsg("warn","Recuperação de senha será tratada pelo administrador.")});
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();if($("loginButton").disabled)return;hideMsg();resetFirstAccess();const username=$("username").value.trim(),password=$("password").value;
  if(!username||!password){setMsg("error","Informe usuário e senha.");return;}
  const attempt=++authAttempt;$("loginButton").disabled=true;$("loginButton").textContent="Entrando...";
  try{
    const result=await cognitoLogin(username,password);if(attempt!==authAttempt)return;
    if(result.ChallengeName==="NEW_PASSWORD_REQUIRED")beginFirstAccess(result,username);else finishLogin(result.AuthenticationResult,username);
  }catch(error){if(attempt===authAttempt)setMsg("error",error.code==="NotAuthorizedException"?"Usuário ou senha inválidos. Confira o acesso informado pelo administrador.":error.message||"Não foi possível entrar.");}
  finally{if(attempt===authAttempt){$("loginButton").disabled=false;$("loginButton").textContent="Entrar";}}
});
$("newPasswordForm").addEventListener("submit",async event=>{
  event.preventDefault();const button=$("newPasswordButton");if(button.disabled||!firstAccessChallenge)return;
  const password=$("newPassword").value,confirmation=$("newPasswordConfirm").value,message=$("newPasswordMessage");
  message.className="message hidden";message.textContent="";
  if(password!==confirmation){message.className="message error";message.textContent="As senhas não conferem. Digite a mesma nova senha nos dois campos.";return;}
  if(password.length<8||!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/[0-9]/.test(password)||password.startsWith("JpEpi1-Inicial-")){
    message.className="message error";message.textContent="Escolha uma senha definitiva com pelo menos 8 caracteres, uma letra maiúscula, uma minúscula e um número. Use uma senha diferente da inicial.";return;
  }
  const attempt=++authAttempt,challenge=firstAccessChallenge;button.disabled=true;
  try{
    const result=await cognitoRequest("RespondToAuthChallenge",{ChallengeName:"NEW_PASSWORD_REQUIRED",Session:challenge.session,ChallengeResponses:{USERNAME:challenge.cognitoUsername,NEW_PASSWORD:password}});
    if(attempt!==authAttempt)return;
    if(result.ChallengeName)throw new Error("Este acesso exige uma verificação adicional. Solicite orientação ao administrador.");
    finishLogin(result.AuthenticationResult,challenge.username);
  }catch(error){if(attempt===authAttempt){message.className="message error";message.textContent=error.code==="InvalidPasswordException"?"A senha não atende aos requisitos. Use ao menos 8 caracteres, com letras maiúsculas, minúsculas e números.":error.code==="NotAuthorizedException"?"O primeiro acesso expirou. Volte à tela de acesso e entre novamente com a senha inicial.":error.message||"Não foi possível definir a senha.";}}
  finally{if(attempt===authAttempt)button.disabled=false;}
});
$("newPasswordCancel").addEventListener("click",()=>{authAttempt++;resetFirstAccess();$("loginButton").disabled=false;$("loginButton").textContent="Entrar";$("newPasswordButton").disabled=false;$("username")?.focus();});
async function submitCadastro(event, path, empresaRequired=false) {
  event.preventDefault();
  if(empresaRequired&&!requireEmpresa())return;
  const form=event.target,button=form.querySelector('button[type="submit"]'),generation=sessionGeneration,company=companyGeneration;
  if(button.disabled)return;
  button.disabled=true;clearAppError();
  try{
    const body=formDataObj(form);
    if(empresaRequired)body.empresaId=activeEmpresaId;
    if(path==="/api/epis"){
      body.tipo=$("epiSemCa").checked?"sem_ca":"epi_ca";delete body.tipoCadastro;delete body.empresaId;
      if(body.tipo==="sem_ca"){body.ca="";body.validade="";body.situacao="Sem CA";}
    }
    const result=ensureSuccess(await api(path,{method:"POST",body:JSON.stringify(body)}),"Não foi possível salvar o cadastro.");
    form.reset();if(path==="/api/epis")updateEquipmentKind();await refreshAll();
    if(generation!==sessionGeneration||(empresaRequired&&company!==companyGeneration))return;
    if(path==="/api/epis"){ $("appMessage").className="message success";$("appMessage").textContent=result.body?.reutilizado?"O equipamento já estava no catálogo compartilhado e está disponível para uso.":"Equipamento incluído no catálogo compartilhado de todas as empresas.";}
  }catch(error){if(generation===sessionGeneration&&(!empresaRequired||company===companyGeneration))handleAppError(error);}finally{if(generation===sessionGeneration&&(!empresaRequired||company===companyGeneration))button.disabled=false;}
}
$("empresaForm").addEventListener("submit",submitCompany);
$("trabalhadorForm").addEventListener("submit",event=>submitCadastro(event,"/api/trabalhadores",true));
$("epiForm").addEventListener("submit",event=>submitCadastro(event,"/api/epis"));
$("empresaCnpj").addEventListener("input",()=>{if(companyLoginAutomatic)$("empresaLogin").value=normalizedCnpj($("empresaCnpj").value).toLowerCase();});
$("empresaLogin").addEventListener("input",()=>{companyLoginAutomatic=!$("empresaLogin").value.trim();});
$("empresaForm").addEventListener("input",()=>{empresaRequestId="";});
$("empresaLogoFile").addEventListener("change",event=>selectLogo(event,false));
$("empresaLogoAtualFile").addEventListener("change",event=>selectLogo(event,true));
$("empresaLogoRemove").addEventListener("click",()=>{logoCreateGeneration++;logoCreateLoading=false;updateCompanySubmitButton();empresaLogoDraft="";empresaRequestId="";$("empresaLogoFile").value="";setLogoPreview("empresaLogoPreview","empresaLogoPreviewWrap","");});
$("empresaLogoAtualRemove").addEventListener("click",()=>{logoEditGeneration++;empresaLogoEdit="";$("empresaLogoAtualFile").value="";setLogoPreview("empresaLogoAtualPreview","empresaLogoAtualPreviewWrap","");$("empresaLogoEmpty").classList.remove("hidden");$("empresaLogoSave").disabled=false;$("empresaLogoAtualRemove").disabled=true;});
$("empresaLogoForm").addEventListener("submit",submitCompanyLogo);
$("empresaAccessForm").addEventListener("submit",submitExistingCompanyAccess);
$("empresaAccessForm").addEventListener("input",event=>{event.currentTarget.dataset.requestId="";});
$("empresaAccessCnpj").addEventListener("input",()=>{$("empresaAccessLogin").value=normalizedCnpj($("empresaAccessCnpj").value).toLowerCase();});
$("empresaCredentialsDismiss").addEventListener("click",clearCredentials);
$("empresaCredentialsToggle").addEventListener("click",()=>{const input=$("empresaCredentialsPassword"),visible=input.type==="password";input.type=visible?"text":"password";setText("empresaCredentialsToggle",visible?"Ocultar":"Mostrar");});
$("trabalhadoresTemplateButton").addEventListener("click",downloadWorkersTemplate);
$("trabalhadoresImportFile").addEventListener("change",previewWorkersFile);
$("trabalhadoresImportCommit").addEventListener("click",()=>confirmWorkersImport().catch(handleAppError));
$("trabalhadoresImportCancel").addEventListener("click",()=>{clearImportReference();clearImportPreview();});
$("trabalhadorSearch").addEventListener("input",renderTrabalhadores);
$("epiSearch").addEventListener("input",renderEpis);
["epiComCa","epiSemCa"].forEach(id=>$(id).addEventListener("change",updateEquipmentKind));
$("entregaForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!requireEmpresa())return;
  const form=event.target,button=form.querySelector('button[type="submit"]'),generation=sessionGeneration,company=companyGeneration;
  if(button.disabled)return;
  button.disabled=true;clearAppError();
  try{
    const body=formDataObj(form);
    const empresa=cache.empresas.find(item=>item.id===activeEmpresaId)||{};
    const epi=cache.epis.find(item=>item.id===body.epiId);
    const trabalhador=cache.trabalhadores.find(item=>item.id===body.trabalhadorId);
    if(!trabalhador||!epi)throw new Error("Selecione o trabalhador da empresa e um equipamento do catálogo.");
    const quantidade=Number(body.quantidade);
    if(!Number.isInteger(quantidade)||quantidade<1)throw new Error("Informe uma quantidade inteira maior que zero.");
    const payload={
      empresaId:activeEmpresaId,trabalhadorId:trabalhador.id,
      trabalhadorNome:trabalhador.nomeCompleto||trabalhador.nome||trabalhador.name,
      tipo:body.tipo,data:new Date().toLocaleDateString("pt-BR"),
      ...window.JP_FICHA.createSnapshot(empresa,trabalhador),
      itens:[{epiId:epi.id,epiDescricao:epi.descricao||epi.name,ca:epi.ca,tipo:epi.tipo||"epi_ca",semCA:isWithoutCA(epi),quantidade}]
    };
    ensureSuccess(await api("/api/fichas",{method:"POST",body:JSON.stringify(payload)}),"Não foi possível gerar a ficha de EPI.");
    await refreshAll();if(generation!==sessionGeneration||company!==companyGeneration)return;goScreen("fichas");
  }catch(error){if(generation===sessionGeneration&&company===companyGeneration)handleAppError(error);}finally{if(generation===sessionGeneration&&company===companyGeneration)button.disabled=false;}
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
renderRoleAccess();updateEquipmentKind();
const remembered=localStorage.getItem(rememberedUserKey);if(remembered){$("username").value=remembered;$("rememberUser").checked=true}if(getAuth())showApp();
