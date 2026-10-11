let jpgedItems=[],jpgedCursor='',jpgedGeneration=0,certificateGeneration=0;
function certificateIndicator(label,state,detail=''){
  const chip=$('healthCertificate');if(!chip)return;
  chip.dataset.state=state;chip.querySelector('span').textContent=label;
  chip.title=(detail||label)+' — Abrir configuração do certificado';
}
function resetJpged(){jpgedItems=[];jpgedCursor='';jpgedGeneration++;certificateGeneration++;certificateIndicator('Não verificado','idle');setText('jpgedList','Selecione uma empresa.');setText('certificateDetail','Consulte o certificado da empresa em uso.');setText('certificateState','Não consultado');$('certificateDisconnect')?.classList.add('hidden');}
function jpgedCompanyName(){return cache.empresas.find(x=>x.id===activeEmpresaId)?.nome||'Selecione uma empresa';}
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
  const status=await getBiometricClient().discover({requireCertificates:true});assertOperationContext(context);
  if(!status.certificatesAvailable)throw new Error(status.runtimeMessage?`JP Biometria ${status.version}: ${status.runtimeMessage}`:`O JP Biometria ${status.version} encontrado neste computador não oferece certificados. Baixe e execute o instalador completo disponível abaixo e clique novamente em Cadastrar no cofre. O leitor USB não é necessário para esta configuração.`);
  const controller=new AbortController();operationControllers.add(controller);const timer=setTimeout(()=>controller.abort(),190000);
  try{
    const response=await fetch(`http://127.0.0.1:${status.port}/api/certificate/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:getAuth().idToken,empresaId:context.empresa,...(jobId?{jobId}:{})}),credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',signal:controller.signal});
    const body=await response.json();assertOperationContext(context);if(!response.ok||body.ok===false)throw new Error(body.message||body.error||'A certificação não foi concluída.');return body;
  }finally{clearTimeout(timer);operationControllers.delete(controller);}
}
function authorizeCertificateChange(context){
  if(!isMaster())return Promise.reject(new Error('Somente o Master pode alterar certificados.'));
  return new Promise((resolve,reject)=>{
    const dialog=dialogShell(document,'Autorizar alteração do certificado',jpgedCompanyName()+' · Confirme sua senha de Master.');
    dialog.querySelector('.dialog-content').innerHTML='<form><label for="vaultMasterPassword">Senha do Master</label><input id="vaultMasterPassword" type="password" autocomplete="current-password" required><button type="submit" class="btn btn-primary">Autorizar esta alteração</button></form>';
    let done=false;const form=dialog.querySelector('form'),field=dialog.querySelector('input');field.focus();
    dialog.addEventListener('close',()=>{field.value='';if(!done)reject(new Error('Alteração cancelada.'));},{once:true});
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
      try{assertOperationContext(context);const auth=getAuth(),result=await cognitoLogin(auth.username,field.value);field.value='';assertOperationContext(context);
        const payload=parseJwt(result.AuthenticationResult?.IdToken||'');if(!result.AuthenticationResult?.IdToken||payload.sub!==auth.payload.sub||!payload['cognito:groups']?.includes('MASTER'))throw new Error('A senha não confirmou o mesmo usuário Master.');
        saveAuth(result.AuthenticationResult,auth.username);done=true;dialog.close();resolve();
      }catch(error){field.value='';dialogMessage(dialog,error.message,'error');button.disabled=false;}
    };
  });
}
async function configureCompanyCertificate(){
  if(!isMaster()||!activeEmpresaId){setText('certificateMessage','Entre como Master e selecione uma empresa.');return;}
  const context=operationContext(),button=$('certificateConfigure');if(button.disabled)return;button.disabled=true;
  try{await authorizeCertificateChange(context);assertOperationContext(context);setText('certificateMessage','Abra o A1 na janela do JP Biometria, digite a senha do arquivo e confirme a empresa.');
    await certificateAgent('configure','',context);assertOperationContext(context);setText('certificateMessage','Certificado protegido no cofre. Os clientes já podem certificar as fichas após a biometria, sem instalar o A1.');await loadCompanyCertificate();}
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
async function loadJpged(next=false){
  const context=operationContext(),generation=++jpgedGeneration;setText('jpgedCompany',jpgedCompanyName());
  if(!activeEmpresaId){setText('jpgedList','Selecione uma empresa no topo da página.');return;}
  if(!next){jpgedItems=[];jpgedCursor='';}setText('jpgedList','Consultando documentos...');
  try{const r=ensureSuccess(await api('/api/jpged/documentos'+(next&&jpgedCursor?'?cursor='+encodeURIComponent(jpgedCursor):'')));assertOperationContext(context);if(generation!==jpgedGeneration)return;jpgedItems=r.body.items||[];jpgedCursor=r.body.cursor||'';renderJpged();}
  catch(error){try{assertOperationContext(context);if(generation===jpgedGeneration)setText('jpgedList',error.message);}catch{}}
}
function renderJpged(){
  const search=normalizeSearch($('jpgedSearch')?.value||''),rows=jpgedItems.filter(x=>!search||normalizeSearch(`${x.trabalhadorNome} ${x.numero}`).includes(search));
  $('jpgedList').innerHTML=rows.length?rows.map(x=>`<div class="ficha-row"><div><strong>${escapeHtml(x.trabalhadorNome)}</strong><small>${escapeHtml(x.numero)} · ${escapeHtml(x.tipo)} · ${escapeHtml(x.data)}</small><small>Certificado em ${escapeHtml(new Date(x.certifiedAt).toLocaleString('pt-BR'))}</small></div><div class="item-actions"><span class="ficha-state signed">Biometria confirmada · Documento certificado</span><button class="btn btn-secondary" type="button" data-jpged="${escapeHtml(x.id)}">Baixar PDF original</button></div></div>`).join(''):'Nenhum documento certificado encontrado nesta página.';
  $('jpgedList').querySelectorAll('[data-jpged]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await downloadJpged(button.dataset.jpged);}catch(error){handleAppError(error);}finally{button.disabled=false;}});
  $('jpgedNext').classList.toggle('hidden',!jpgedCursor);
}
async function downloadJpged(id){
  const context=operationContext(),r=ensureSuccess(await api('/api/jpged/documentos/'+encodeURIComponent(id)+'/download'));assertOperationContext(context);
  const url=new URL(r.body.url);if(url.protocol!=='https:'||!/^jpged-documentos-003020057405\.s3(?:\.sa-east-1)?\.amazonaws\.com$/.test(url.hostname))throw new Error('Endereço de download não reconhecido.');
  const link=document.createElement('a');link.href=url.href;link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.download='';document.body.appendChild(link);link.click();link.remove();
}
