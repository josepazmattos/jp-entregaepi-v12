(function ensureConfig(){if(!window.JP_CONFIG||!window.JP_CONFIG.apiBaseUrl){window.JP_CONFIG={version:"12.7.1",appBasePath:"/EntregaEPI/",apiBaseUrl:"https://g4pdu3t1va.execute-api.sa-east-1.amazonaws.com",cognitoRegion:"sa-east-1",userPoolId:"sa-east-1_3FNCoTvr0",clientId:"2q2inha617oeer4vb0m0hjoja0",ambiente:"producao"}}})();
const $=id=>document.getElementById(id), tokenKey="jp-v12-auth", rememberedUserKey="jp-v12-remembered-user", activeCompanyKey="jp-v12-active-company";
let sessionGeneration=0;let lastSessionUsername="";let cache={empresas:[],trabalhadores:[],epis:[],fichas:[]};let activeEmpresaId=localStorage.getItem(activeCompanyKey)||"";
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
async function testHealth(){try{write("Testando API...");write(await api("/health"))}catch(error){write(error.message)}}
async function testCA(){try{write("Consultando CA 365...");write(await api("/api/caepi/365"))}catch(error){write(error.message)}}
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
  $("configOutput").textContent=JSON.stringify(window.JP_CONFIG,null,2);
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
async function testBiometriaLocal(){const out=$("bioOutput");out.textContent="Consultando JP Biometria local...";try{const r=await fetch("http://127.0.0.1:8789/status");const text=await r.text();let body=text;try{body=JSON.parse(text)}catch(e){}out.textContent=JSON.stringify({status:r.status,body},null,2)}catch(e){out.textContent="JP Biometria local não respondeu: "+e.message}}
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
function showApp(){const auth=getAuth();if(!auth)return;$("loginPage").classList.add("hidden");$("appShell").classList.remove("hidden");$("userBadge").textContent=auth.username||"Usuário autenticado";$("configOutput").textContent=JSON.stringify(window.JP_CONFIG,null,2);refreshAll().catch(handleAppError)}
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
document.querySelectorAll(".nav button").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));$("screen-"+btn.dataset.screen).classList.add("active")}));
const remembered=localStorage.getItem(rememberedUserKey);if(remembered){$("username").value=remembered;$("rememberUser").checked=true}if(getAuth())showApp();
