let jpgedItems=[],jpgedCursor='',jpgedGeneration=0,certificateGeneration=0,jpgedSyncTimer=null,jpgedRequestCursor='';
function certificateIndicator(label,state,detail=''){
  const chip=$('healthCertificate');if(!chip)return;
  chip.dataset.state=state;chip.querySelector('span').textContent=label;
  chip.title=(detail||label)+(isMaster()?' — Abrir administração do certificado':' — Consultar situação do certificado');
}
function resetJpged(){resetV10Destination();clearTimeout(jpgedSyncTimer);jpgedRequestCursor='';if(typeof certificateCleanup==='function')certificateCleanup();jpgedItems=[];jpgedCursor='';jpgedGeneration++;certificateGeneration++;certificateIndicator('Não verificado','idle');setText('jpgedList','Selecione uma empresa.');setText('certificateDetail','Consulte o certificado da empresa em uso.');setText('certificateState','Não consultado');$('certificateDisconnect')?.classList.add('hidden');}
function jpgedCompanyName(){return cache.empresas.find(x=>x.id===activeEmpresaId)?.nome||'Selecione uma empresa';}
function openCertificateStatus(){
  if(isMaster()){goScreen('certificado');return;}
  const dialog=dialogShell(document,'Situação do certificado',jpgedCompanyName());
  dialog.querySelector('.dialog-content').textContent='Certificado: '+$('healthCertificate').querySelector('span').textContent+'. A instalação e a manutenção são realizadas pelo administrador Master.';
}
async function loadCompanyCertificate(){
  const context=operationContext(),generation=++certificateGeneration;setText('certificateCompany',jpgedCompanyName());$('certificateConfigure')?.classList.toggle('hidden',!isMaster());
  if(!activeEmpresaId){certificateIndicator('Selecione empresa','idle');setText('certificateDetail','Selecione uma empresa no topo da página.');return;}
  certificateIndicator('Verificando','loading');
  try{const r=ensureSuccess(await diagnosticApi('/api/jpged/certificado'));assertOperationContext(context);if(generation!==certificateGeneration)return;const cert=r.body.certificate;
    const vaultReady=!cert||cert.mode!=='vault'||cert.vaultState==='Enabled';
    const expired=cert&&new Date(cert.validTo)<=new Date(),valid=cert&&vaultReady&&new Date(cert.validTo)>new Date()&&(!cert.validFrom||new Date(cert.validFrom)<=new Date());
    certificateIndicator(!cert?'Pendente':expired?'Vencido':valid?'Configurado':'Verificar',valid?'success':'warning',valid?`Certificado cadastrado para ${jpgedCompanyName()}, válido até ${new Date(cert.validTo).toLocaleDateString('pt-BR')}. ${cert.mode==='vault'?'Chave protegida no cofre; uso automático nas fichas.':'Configuração local anterior; solicite ao Master a migração para o cofre.'}`:'');
    setText('certificateState',!cert?'Não configurado':expired?'Vencido':valid?(cert.mode==='vault'?'Protegido no cofre':cert.kind==='e-CPF'?'e-CPF configurado':'Configurado'):!vaultReady?'Cofre indisponível':'Verificar validade');
    setText('certificateDetail',cert?`${cert.subject.replaceAll('\n',' · ')} · Validade: ${new Date(cert.validTo).toLocaleDateString('pt-BR')}`:(isMaster()?'Cadastre uma vez o A1 e-CNPJ ou e-CPF no cofre desta empresa.':'Solicite ao administrador o cadastro do certificado. Você não precisa instalar o A1 neste computador.'));
    $('certificateDisconnect').classList.toggle('hidden',!cert||!isMaster());

  }catch(error){try{assertOperationContext(context);if(generation!==certificateGeneration)return;certificateIndicator('Indisponível','error');setText('certificateMessage',error.message);}catch{}}
}
async function certificateAgent(action,jobId,context){
  const status=await getBiometricClient().discover();assertOperationContext(context);
  if(!status.certificatesAvailable)throw new Error(status.runtimeMessage?`JP Biometria ${status.version}: ${status.runtimeMessage}`:`O JP Biometria ${status.version} encontrado neste computador não oferece certificados. Solicite ao Master o cadastro em Sistema → Certificado Digital para usar o cofre.`);
  const controller=new AbortController();operationControllers.add(controller);const timer=setTimeout(()=>controller.abort(),190000);
  try{
    const response=await fetch(`http://127.0.0.1:${status.port}/api/certificate/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:getAuth().idToken,empresaId:context.empresa,...(jobId?{jobId}:{})}),credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',signal:controller.signal});
    const body=await response.json();assertOperationContext(context);if(!response.ok||body.ok===false)throw new Error(body.message||body.error||'A certificação não foi concluída.');return body;
  }finally{clearTimeout(timer);operationControllers.delete(controller);}
}
function authorizeCertificateChange(context,title='Autorizar alteração do certificado'){
  if(!isMaster())return Promise.reject(new Error('Somente o Master pode alterar certificados.'));
  return new Promise((resolve,reject)=>{
    const dialog=dialogShell(document,title,jpgedCompanyName()+' · Confirme sua senha de Master.');
    dialog.querySelector('.dialog-content').innerHTML='<form><label for="vaultMasterPassword">Senha do Master</label><input id="vaultMasterPassword" type="password" autocomplete="current-password" required><button type="submit" class="btn btn-primary">Autorizar esta alteração</button></form>';
    let done=false;const form=dialog.querySelector('form'),field=dialog.querySelector('input');field.focus();
    dialog.addEventListener('close',()=>{field.value='';if(!done)reject(new Error('Alteração cancelada.'));},{once:true});
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
      try{assertOperationContext(context);const auth=getAuth(),initial=await cognitoLogin(auth.username,field.value);field.value='';const result=await finishMfaChallenge(initial,auth.username);assertOperationContext(context);
        const payload=parseJwt(result.AuthenticationResult?.IdToken||'');if(!result.AuthenticationResult?.IdToken||payload.sub!==auth.payload.sub||!payload['cognito:groups']?.includes('MASTER'))throw new Error('A senha não confirmou o mesmo usuário Master.');
        saveAuth(result.AuthenticationResult,auth.username);done=true;dialog.close();resolve();
      }catch(error){field.value='';dialogMessage(dialog,error.message,'error');button.disabled=false;}
    };
  });
}
async function configureCompanyCertificate(){
  if(!isMaster()||!activeEmpresaId){setText('certificateMessage','Entre como Master e selecione uma empresa.');return;}
  const context=operationContext(),button=$('certificateConfigure');if(button.disabled)return;button.disabled=true;
  try{await authorizeCertificateChange(context);assertOperationContext(context);setText('certificateMessage','Escolha o arquivo A1 e confira o certificado para esta empresa.');
    await installCertificateA1(context);assertOperationContext(context);setText('certificateMessage','Certificado protegido no cofre. Os clientes já podem certificar as fichas após a biometria, sem instalar o A1.');await loadCompanyCertificate();}
  catch(error){try{assertOperationContext(context);setText('certificateMessage',error.message);}catch{}}finally{button.disabled=false;}
}
async function disconnectCompanyCertificate(){
  if(!isMaster())return;
  const context=operationContext();if(!confirm('Desativar o certificado desta empresa? Novas certificações serão bloqueadas. Os PDFs já certificados serão preservados.'))return;
  try{await authorizeCertificateChange(context);assertOperationContext(context);ensureSuccess(await api('/api/jpged/certificado/desvincular',{method:'POST',body:'{}'}));assertOperationContext(context);await loadCompanyCertificate();setText('certificateMessage','Certificado desativado. Os documentos anteriores foram preservados.');}
  catch(error){setText('certificateMessage',error.message);}
}
async function certifyFicha(id,preview,context=operationContext()){
  assertOperationContext(context);
  const message=text=>{if(preview&&!preview.closed)preview.document.getElementById('printSignatureStatus').textContent=text;};
  message('Biometria confirmada · Preparando o documento certificado...');
  const r=ensureSuccess(await api('/api/jpged/fichas/'+encodeURIComponent(id)+'/preparar',{method:'POST',body:'{}'}));assertOperationContext(context);
  if(!r.body.completed){message('Biometria confirmada · Assinando com o certificado da empresa...');if(r.body.mode==='vault')ensureSuccess(await api('/api/jpged/assinaturas/'+encodeURIComponent(r.body.jobId)+'/certificar',{method:'POST',body:'{}'}));else await certificateAgent('sign',r.body.jobId,context);}
  await refreshFichas(false);assertOperationContext(context);
  const ficha=cache.fichas.find(x=>x.id===id);if(preview&&ficha)updatePrintWindow(preview,ficha);
  return ficha;
}
async function loadJpged(next=false,refresh=false){
  clearTimeout(jpgedSyncTimer);
  const context=operationContext(),generation=++jpgedGeneration;setText('jpgedCompany',jpgedCompanyName());
  if(!next&&!refresh)loadV10Destination();
  if(!activeEmpresaId){setText('jpgedList','Selecione uma empresa no topo da página.');return;}
  const requestCursor=refresh?jpgedRequestCursor:next?jpgedCursor:'';jpgedRequestCursor=requestCursor;
  if(!next&&!refresh){jpgedItems=[];jpgedCursor='';}if(!refresh)setText('jpgedList','Consultando documentos...');
  try{const r=ensureSuccess(await api('/api/jpged/documentos'+(requestCursor?'?cursor='+encodeURIComponent(requestCursor):'')));assertOperationContext(context);if(generation!==jpgedGeneration)return;jpgedItems=r.body.items||[];jpgedCursor=r.body.cursor||'';renderJpged();
    if(jpgedItems.some(item=>item.v10Sync?.status==='pending'))jpgedSyncTimer=setTimeout(()=>{if(generation===jpgedGeneration&&document.visibilityState==='visible'&&$('screen-jpged')?.classList.contains('active'))loadJpged(false,true);},30000);}
  catch(error){try{assertOperationContext(context);if(generation===jpgedGeneration&&!refresh)setText('jpgedList',error.message);}catch{}}
}
function renderJpged(){
  const search=normalizeSearch($('jpgedSearch')?.value||''),rows=jpgedItems.filter(x=>!search||normalizeSearch(`${x.trabalhadorNome} ${x.numero}`).includes(search));
  $('jpgedList').innerHTML=rows.length?rows.map(x=>`<div class="ficha-row"><div><strong>${escapeHtml(x.trabalhadorNome)}</strong><small>${escapeHtml(x.numero)} · ${escapeHtml(x.tipo)} · ${escapeHtml(x.data)}</small><small>Original certificado em ${escapeHtml(new Date(x.certifiedAt).toLocaleString('pt-BR'))}</small>${x.compactRevision?`<small>Impressão compacta certificada em ${escapeHtml(new Date(x.compactRevision.certifiedAt).toLocaleString('pt-BR'))}</small>`:''}</div><div class="item-actions"><span class="ficha-state signed">Biometria confirmada · Documento certificado</span><button class="btn btn-secondary" type="button" data-jpged="${escapeHtml(x.id)}">${x.compactRevision?'Baixar PDF atualizado':'Baixar PDF original'}</button>${x.compactRevision?`<button class="btn btn-secondary" type="button" data-jpged="${escapeHtml(x.id)}" data-original="true">Original anterior</button>`:x.layoutVersion==='compact-1'?'':`<button class="btn btn-primary" type="button" data-layout="${escapeHtml(x.id)}">Atualizar impressão</button>`}</div></div>`).join(''):'Nenhum documento certificado encontrado nesta página.';
  rows.forEach((item,index)=>{
    if(item.v10Sync?.status!=='pending')return;
    const actions=$('jpgedList').children[index]?.querySelector('.item-actions');if(!actions)return;
    const indicator=document.createElement('span');indicator.className='ficha-state jp-v10-pending';
    indicator.textContent='V10: não sincronizada';indicator.tabIndex=0;
    indicator.title=item.v10Sync.message||'Envio pendente. O sistema tentará novamente automaticamente.';
    indicator.setAttribute('aria-label',indicator.textContent+'. '+indicator.title);
    actions.prepend(indicator);
  });
  $('jpgedList').querySelectorAll('[data-jpged]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await downloadJpged(button.dataset.jpged,button.dataset.original==='true');}catch(error){handleAppError(error);}finally{button.disabled=false;}});
  $('jpgedList').querySelectorAll('[data-layout]').forEach(button=>button.onclick=()=>updateJpgedLayout(button));
  $('jpgedNext').classList.toggle('hidden',!jpgedCursor);
}
async function updateJpgedLayout(button){
  if(button.disabled)return;
  const context=operationContext(),id=button.dataset.layout;
  if(!confirm('Criar uma nova versão com a impressão compacta?\n\nOs dados e a biometria serão preservados, sem nova leitura. O cofre aplicará uma nova certificação. O PDF anterior continuará disponível.'))return;
  const controller=new AbortController();operationControllers.add(controller);clearAppError();button.disabled=true;button.textContent='Atualizando impressão…';
  try{
    const result=ensureSuccess(await api('/api/jpged/documentos/'+encodeURIComponent(id)+'/atualizar-layout',{method:'POST',body:'{}',signal:controller.signal}));assertOperationContext(context);
    jpgedItems=jpgedItems.map(item=>item.id===id?{...item,layoutVersion:'compact-1',compactRevision:result.body.revision||item.compactRevision,...(item.v10Sync?{v10Sync:{status:'pending',message:'A versão atualizada será enviada automaticamente ao V10.'}}:{})}:item);renderJpged();
    setText('appMessage','Impressão atualizada. Baixe o PDF atualizado; o original anterior foi preservado.');$('appMessage').className='message success';
  }catch(error){try{assertOperationContext(context);handleAppError(error);}catch{}}
  finally{operationControllers.delete(controller);button.disabled=false;button.textContent='Atualizar impressão';}
}
async function downloadJpged(id,original=false){
  const context=operationContext(),r=ensureSuccess(await api('/api/jpged/documentos/'+encodeURIComponent(id)+'/download'+(original?'?versao=original':'')));assertOperationContext(context);
  const url=new URL(r.body.url);if(url.protocol!=='https:'||!/^jpged-documentos-003020057405\.s3(?:\.sa-east-1)?\.amazonaws\.com$/.test(url.hostname))throw new Error('Endereço de download não reconhecido.');
  const link=document.createElement('a');link.href=url.href;link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.download='';document.body.appendChild(link);link.click();link.remove();
}

let jpgedDestinationState=null,jpgedDestinationGeneration=0,jpgedDestinationSearchTimer;
function resetV10Destination(){clearTimeout(jpgedDestinationSearchTimer);jpgedDestinationGeneration++;jpgedDestinationState=null;$('jpgedDestination')?.classList.add('hidden');$('jpgedDestinationEdit')?.classList.add('hidden');}
async function loadV10Destination(){
  resetV10Destination();const panel=$('jpgedDestination');if(!panel||!isMaster()||!activeEmpresaId)return;
  const context=operationContext(),generation=jpgedDestinationGeneration;
  try{const r=ensureSuccess(await api('/api/jpged/v10/destino'));assertOperationContext(context);if(generation!==jpgedDestinationGeneration)return;
    jpgedDestinationState=r.body;if(!r.body.eligible)return;
    if(r.body.selected&&!r.body.stale){$('jpgedDestinationEdit')?.classList.remove('hidden');return;}
    await openV10Destination();
  }catch(error){try{assertOperationContext(context);if(generation===jpgedDestinationGeneration){panel.classList.add('hidden');$('jpgedDestinationEdit')?.classList.add('hidden');$('jpgedDestinationSave').disabled=true;}}catch{}}
}
async function openV10Destination(){
    if(!jpgedDestinationState?.eligible||!isMaster()||!activeEmpresaId)return;
    const selected=jpgedDestinationState.selected;
    $('jpgedDestinationEdit')?.classList.add('hidden');$('jpgedDestination').classList.remove('hidden');
    $('jpgedDestinationCancel')?.classList.toggle('hidden',!selected||!!jpgedDestinationState.stale);
    $('jpgedDestinationQuery').value='';$('jpgedDestinationSelect').replaceChildren();$('jpgedDestinationSave').disabled=true;
    setText('jpgedDestinationMessage',selected?'Destino salvo: '+selected.nome+' · '+selected.pasta:'O CNPJ não encontrou um destino automático. Selecione a empresa ou pasta do grupo econômico uma única vez.');
    $('jpgedDestinationQuery').focus();
    await searchV10Destinations();
}
function closeV10Destination(){
  if(!isMaster()||!jpgedDestinationState?.selected||jpgedDestinationState.stale)return;
  clearTimeout(jpgedDestinationSearchTimer);jpgedDestinationGeneration++;
  $('jpgedDestination').classList.add('hidden');$('jpgedDestinationEdit').classList.remove('hidden');$('jpgedDestinationEdit').focus();
}
async function searchV10Destinations(){
  if(!jpgedDestinationState?.eligible||!isMaster()||$('jpgedDestination')?.classList.contains('hidden'))return;const context=operationContext(),generation=++jpgedDestinationGeneration,select=$('jpgedDestinationSelect');
  $('jpgedDestinationSave').disabled=true;
  try{const q=$('jpgedDestinationQuery').value;const r=ensureSuccess(await api('/api/jpged/v10/destinos?q='+encodeURIComponent(q)));assertOperationContext(context);if(generation!==jpgedDestinationGeneration)return;
    select.replaceChildren();for(const item of r.body.items||[]){const option=document.createElement('option');option.value=String(item.id);option.textContent=item.nome+' · '+item.pasta+(item.cnpj?' · '+item.cnpj:'');select.append(option);}select.selectedIndex=-1;
    setText('jpgedDestinationResults',r.body.items?.length?(r.body.more?'Refine a busca para encontrar outras pastas.':'Selecione o destino desejado.'): 'Nenhuma pasta encontrada.');
  }catch(error){try{assertOperationContext(context);if(generation===jpgedDestinationGeneration)setText('jpgedDestinationResults',error.message);}catch{}}
}
async function saveV10Destination(){
  if(!jpgedDestinationState?.eligible||!isMaster())return;const context=operationContext(),button=$('jpgedDestinationSave');if(button.disabled)return;
  const destinationId=Number($('jpgedDestinationSelect').value),version=jpgedDestinationState.version;button.disabled=true;
  try{const r=ensureSuccess(await api('/api/jpged/v10/destino',{method:'POST',body:JSON.stringify({destinationId,version})}));assertOperationContext(context);setText('jpgedDestinationMessage',r.body.message);await loadJpged(false,true);await loadV10Destination();}
  catch(error){try{assertOperationContext(context);setText('jpgedDestinationMessage',error.message);}catch{}}
}
$('jpgedDestinationQuery')?.addEventListener('input',()=>{clearTimeout(jpgedDestinationSearchTimer);jpgedDestinationSearchTimer=setTimeout(searchV10Destinations,300);});
$('jpgedDestinationSelect')?.addEventListener('change',()=>{$('jpgedDestinationSave').disabled=!$('jpgedDestinationSelect').value;});
$('jpgedDestinationSave')?.addEventListener('click',saveV10Destination);
$('jpgedDestinationEdit')?.addEventListener('click',openV10Destination);
$('jpgedDestinationCancel')?.addEventListener('click',closeV10Destination);
