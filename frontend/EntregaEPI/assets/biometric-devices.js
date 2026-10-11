async function loadBiometricDevices(){
  if(!isMaster()||!activeEmpresaId){setText('biometricDevicesMessage','Entre como Master e selecione a empresa.');return;}
  const context=operationContext();setText('biometricDevicesMessage','Consultando computadores de '+jpgedCompanyName()+'...');
  try{
    const result=ensureSuccess(await api('/api/biometria/dispositivos'));assertOperationContext(context);
    const rows=result.body.items||[];setText('biometricDevicesMessage',jpgedCompanyName());
    $('biometricDevicesList').innerHTML=rows.length?rows.map(item=>`<div class="ficha-row"><div><strong>${escapeHtml(item.name)}</strong><small>${item.active?'Autorizado':'Desautorizado'} · ${escapeHtml(new Date(item.authorizedAt).toLocaleDateString('pt-BR'))}</small></div>${item.active?`<button type="button" class="btn btn-secondary" data-device="${escapeHtml(item.id)}" data-version="${item.version}">Desautorizar</button>`:''}</div>`).join(''):'Nenhum computador autorizado para compartilhar os cadastros.';
    $('biometricDevicesList').querySelectorAll('[data-device]').forEach(button=>button.onclick=async()=>{
      if(!confirm('Desautorizar este computador para usar as digitais desta empresa? Os cadastros e as fichas serão preservados.'))return;
      button.disabled=true;
      try{assertOperationContext(context);await authorizeCertificateChange(context,'Desautorizar computador biométrico');assertOperationContext(context);ensureSuccess(await api('/api/biometria/dispositivos/'+encodeURIComponent(button.dataset.device)+'/desativar',{method:'POST',body:JSON.stringify({version:Number(button.dataset.version)})}));assertOperationContext(context);await loadBiometricDevices();}catch(error){try{assertOperationContext(context);setText('biometricDevicesMessage',error.message);button.disabled=false;}catch{}}
    });
  }catch(error){try{assertOperationContext(context);setText('biometricDevicesMessage',error.message);}catch{}}
}
async function authorizeBiometricComputer(){
  if(!isMaster()||!activeEmpresaId){setText('biometricDevicesMessage','Entre como Master e selecione a empresa.');return;}
  const context=operationContext();
  try{
    await authorizeCertificateChange(context,'Autorizar computador biométrico');assertOperationContext(context);
    const dialog=dialogShell(document,'Autorizar este computador',jpgedCompanyName());
    dialog.querySelector('.dialog-content').innerHTML='<form><label for="biometricDeviceName">Nome do computador</label><input id="biometricDeviceName" required maxlength="80" placeholder="Ex.: Recepção, Almoxarifado"><p>O leitor usará as digitais salvas no aplicativo para esta empresa. Nenhum trabalhador precisa ser recadastrado.</p><button class="btn btn-primary" type="submit">Autorizar computador</button></form>';
    dialog.querySelector('input').focus();
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const button=dialog.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;
      const controller=new AbortController();operationControllers.add(controller);const abort=()=>controller.abort();dialog.addEventListener('close',abort,{once:true});
      try{
        assertOperationContext(context);dialogMessage(dialog,'Identificando o agente deste computador...');const client=getBiometricClient(),status=await client.discover({signal:controller.signal});assertOperationContext(context);
        if(!status.sharedEnrollmentAvailable)throw new Error('Use Atualizar JP Biometria nesta tela e execute a atualização antes de autorizar este computador.');
        const start=ensureSuccess(await api('/api/biometria/dispositivos/desafio',{method:'POST',body:JSON.stringify({name:dialog.querySelector('input').value.trim()}),signal:controller.signal}));assertOperationContext(context);
        const response=await client.authorizeDevice(start.body.challenge,{signal:controller.signal});assertOperationContext(context);if(response.publicKey!==status.devicePublicKey)throw new Error('O agente mudou durante a autorização. Tente novamente.');
        ensureSuccess(await api('/api/biometria/dispositivos/desafio/'+encodeURIComponent(start.body.challenge.challengeId),{method:'POST',body:JSON.stringify(response),signal:controller.signal}));assertOperationContext(context);
        dialog.close();await loadBiometricDevices();setText('biometricDevicesMessage','Computador autorizado para '+jpgedCompanyName()+'. As digitais já cadastradas estão disponíveis.');
      }catch(error){if(dialog.isConnected){dialogMessage(dialog,error.message,'error');button.disabled=false;}}
      finally{operationControllers.delete(controller);dialog.removeEventListener('close',abort);}
    };
  }catch(error){try{assertOperationContext(context);setText('biometricDevicesMessage',error.message);}catch{}}
}
function clearBiometricDevices(){setText('biometricDevicesMessage','');setText('biometricDevicesList','');}
$('empresaAtivaSelect')?.addEventListener('change',clearBiometricDevices);
$('logoutButton')?.addEventListener('click',clearBiometricDevices);
