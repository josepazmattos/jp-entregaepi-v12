// MFA secrets stay in this browser and Cognito. Codes are sent only to the
// dedicated authentication service, which records the verified token hash.
function securityDialog(title,intro){return dialogShell(document,title,intro);}
async function finishMfaChallenge(result,username){
  if(!result.ChallengeName)return result;
  if(result.ChallengeName!=='SOFTWARE_TOKEN_MFA')throw new Error('Esta verificação não está disponível. Solicite suporte ao Master.');
  return new Promise((resolve,reject)=>{
    const dialog=securityDialog('Confirmar acesso','Digite os seis números exibidos no seu aplicativo autenticador.'),content=dialog.querySelector('.dialog-content');
    content.innerHTML='<form><label for="mfaCode">Código do autenticador</label><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="btn btn-primary" type="submit">CONFIRMAR</button></form>';
    let complete=false,busy=false;
    dialog.addEventListener('close',()=>{content.textContent='';if(!complete)reject(new Error('Verificação cancelada.'));},{once:true});
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    const input=content.querySelector('input');input.focus();
    content.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;const button=content.querySelector('button');button.disabled=true;dialog.querySelector('.dialog-close').disabled=true;
      try{
        const response=await fetch(window.JP_CONFIG.apiBaseUrl+'/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({username:result.ChallengeParameters?.USERNAME||result.ChallengeParameters?.USER_ID_FOR_SRP||result.resolvedUsername||username,session:result.Session,code:input.value.trim()})});input.value='';
        const answer=await response.json();if(!response.ok||!answer.ok||!answer.AuthenticationResult?.IdToken)throw new Error(answer.error||'Não foi possível confirmar o código.');
        complete=true;dialog.close();resolve(answer);
      }catch(error){input.value='';dialogMessage(dialog,error.message,'error');}
      finally{busy=false;button.disabled=false;dialog.querySelector('.dialog-close').disabled=false;}
    };
  });
}
async function securityCognito(operation,payload){
  const response=await fetch('https://cognito-idp.'+window.JP_CONFIG.cognitoRegion+'.amazonaws.com/',{method:'POST',headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'AWSCognitoIdentityProviderService.'+operation},body:JSON.stringify(payload),cache:'no-store'});
  const result=await response.json();if(!response.ok)throw new Error(result.message||'Não foi possível configurar o autenticador.');return result;
}
async function enrollMasterMfa(){
  const auth=getAuth();if(!auth?.accessToken)throw new Error('Entre novamente para configurar o autenticador.');
  const dialog=securityDialog('Proteger o acesso Master','Cadastre seu celular uma vez. Depois, cada entrada solicitará um código do autenticador.');
  const content=dialog.querySelector('.dialog-content');content.textContent='Preparando a configuração...';
  let active=true,secret='';dialog.addEventListener('close',()=>{active=false;secret='';content.textContent='';},{once:true});
  try{
    const result=await securityCognito('AssociateSoftwareToken',{AccessToken:auth.accessToken});
    if(!active||getAuth()?.idToken!==auth.idToken)return;
    secret=result.SecretCode;
    content.innerHTML='<ol><li>Abra o Google Authenticator ou Microsoft Authenticator.</li><li>Adicione uma conta com chave de configuração e selecione código baseado em tempo.</li><li>Use o nome <strong>JP EntregaEPI — Master</strong> e a chave abaixo.</li></ol><label>Chave de configuração</label><code class="mfa-setup-key" style="display:block;overflow-wrap:anywhere;padding:14px;background:#f0f5f3;user-select:all"></code><p>Guarde o acesso ao autenticador. Não compartilhe esta chave.</p><form><label for="mfaSetupCode">Código de seis números</label><input id="mfaSetupCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="btn btn-primary" type="submit">ATIVAR AUTENTICADOR</button></form>';
    content.querySelector('code').textContent=secret;secret='';
    content.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const button=content.querySelector('button'),input=content.querySelector('input');if(button.disabled)return;button.disabled=true;
      try{
        if(getAuth()?.idToken!==auth.idToken)throw new Error('A sessão mudou. Entre novamente.');
        const verified=await securityCognito('VerifySoftwareToken',{AccessToken:auth.accessToken,UserCode:input.value.trim(),FriendlyDeviceName:'JP EntregaEPI Master'});input.value='';
        if(verified.Status!=='SUCCESS')throw new Error('Confira o código e tente novamente.');
        await securityCognito('SetUserMFAPreference',{AccessToken:auth.accessToken,SoftwareTokenMfaSettings:{Enabled:true,PreferredMfa:true}});
        dialog.close();sessionStorage.removeItem(tokenKey);showLogin(true);setMsg('success','Autenticador ativado. Entre com sua senha e confirme o código para concluir.');
      }catch(error){input.value='';dialogMessage(dialog,error.message,'error');button.disabled=false;}
    };
  }catch(error){if(active){content.textContent='';dialogMessage(dialog,error.message,'error');}}
}
let masterSecurityPending=false;
async function allowMasterSession(){
  if(!window.JP_CONFIG.masterMfaRequired||!isMaster())return true;
  const original=getAuth()?.idToken;
  const result=ensureSuccess(await api('/api/seguranca/status'));
  if(getAuth()?.idToken!==original)return false;
  if(result.body.verified)return true;
  $('appShell').classList.add('hidden');$('loginPage').classList.remove('hidden');
  if(result.body.enrolled){sessionStorage.removeItem(tokenKey);showLogin(true);setMsg('warn','Entre novamente e confirme o código do autenticador para acessar como Master.');return false;}
  setMsg('warn','Configure seu autenticador para liberar o acesso Master.');
  if(!masterSecurityPending){masterSecurityPending=true;try{await enrollMasterMfa();}finally{masterSecurityPending=false;}}
  return false;
}
