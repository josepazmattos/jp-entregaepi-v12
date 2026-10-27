// Codes go only to the dedicated authentication service. Cognito completes the
// challenge before that service records a proof for the exact ID token.
function securityDialog(title,intro){return dialogShell(document,title,intro);}
async function finishMfaChallenge(result,username){
  if(!result.ChallengeName)return result;
  if(!['EMAIL_OTP','SOFTWARE_TOKEN_MFA'].includes(result.ChallengeName))throw new Error('Esta verificação não está disponível. Solicite suporte ao administrador.');
  const email=result.ChallengeName==='EMAIL_OTP';
  return new Promise((resolve,reject)=>{
    const dialog=securityDialog(email?'Confira seu e-mail':'Confirmar acesso',email?'Enviamos um código para o e-mail cadastrado. Copie e cole os seis números abaixo.':'Digite os seis números exibidos no seu aplicativo autenticador.'),content=dialog.querySelector('.dialog-content');
    content.innerHTML='<p class="mfa-destination" hidden></p><form><label for="mfaCode">'+(email?'Código recebido por e-mail':'Código do autenticador')+'</label><input id="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="12" placeholder="000000" required><button class="btn btn-primary" type="submit">CONFIRMAR ACESSO</button></form><p class="mfa-help"></p>';
    const destination=result.ChallengeParameters?.CODE_DELIVERY_DESTINATION;
    if(email&&typeof destination==='string'){const el=content.querySelector('.mfa-destination');el.textContent='Enviado para: '+destination;el.hidden=false;}
    content.querySelector('.mfa-help').textContent=email?'O código vale por 10 minutos e é exclusivo desta entrada. Confira também o spam. Para receber outro, feche esta janela e entre novamente.':'Use o código atual do aplicativo autenticador.';
    let complete=false,busy=false;
    dialog.addEventListener('close',()=>{content.textContent='';if(!complete)reject(new Error(email?'Entre novamente para receber um novo código por e-mail.':'Verificação cancelada.'));},{once:true});
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    const input=content.querySelector('input');input.addEventListener('input',()=>{input.value=input.value.replace(/[\s-]/g,'').slice(0,6);});input.focus();
    content.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;const button=content.querySelector('button');button.disabled=true;dialog.querySelector('.dialog-close').disabled=true;
      try{
        const response=await fetch(window.JP_CONFIG.apiBaseUrl+'/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({username:result.ChallengeParameters?.USERNAME||result.ChallengeParameters?.USER_ID_FOR_SRP||result.resolvedUsername||username,session:result.Session,challengeName:result.ChallengeName,code:input.value.trim()})});input.value='';
        const answer=await response.json();if(!response.ok||!answer.ok||!answer.AuthenticationResult?.IdToken)throw new Error(answer.error||'Não foi possível confirmar o código.');
        complete=true;dialog.close();resolve(answer);
      }catch(error){input.value='';dialogMessage(dialog,error.message,'error');input.focus();}
      finally{busy=false;button.disabled=false;dialog.querySelector('.dialog-close').disabled=false;}
    };
  });
}
async function allowMasterSession(){
  if(!window.JP_CONFIG.masterMfaRequired||!isMaster())return true;
  const original=getAuth()?.idToken;
  const result=ensureSuccess(await api('/api/seguranca/status'));
  if(getAuth()?.idToken!==original)return false;
  if(result.body.verified)return true;
  $('appShell').classList.add('hidden');$('loginPage').classList.remove('hidden');
  sessionStorage.removeItem(tokenKey);showLogin(true);
  setMsg('warn',result.body.enrolled?'Entre novamente com sua senha e confirme o código para acessar como Master.':'A confirmação do Master precisa ser configurada pelo administrador. Solicite o cadastro do e-mail autorizado.');
  return false;
}
