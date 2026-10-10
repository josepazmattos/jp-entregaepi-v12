let jpgedItems=[],jpgedCursor='',jpgedGeneration=0;
function resetJpged(){jpgedItems=[];jpgedCursor='';jpgedGeneration++;setText('jpgedList','Selecione uma empresa.');setText('certificateDetail','Consulte o certificado da empresa em uso.');setText('certificateState','Não consultado');$('representativeForm')?.reset();$('representativeForm')?.classList.add('hidden');setText('representativeStatus','Consulte a empresa selecionada.');$('certificateDisconnect')?.classList.add('hidden');}
function jpgedCompanyName(){return cache.empresas.find(x=>x.id===activeEmpresaId)?.nome||'Selecione uma empresa';}
async function loadCompanyCertificate(){
  const context=operationContext();setText('certificateCompany',jpgedCompanyName());
  if(!activeEmpresaId){setText('certificateDetail','Selecione uma empresa no topo da página.');return;}
  try{const r=ensureSuccess(await api('/api/jpged/certificado'));assertOperationContext(context);const cert=r.body.certificate;
    setText('certificateState',cert?(new Date(cert.validTo)>new Date()?(cert.kind==='e-CPF'?'e-CPF configurado':'Configurado'):'Vencido'):'Não configurado');
    setText('certificateDetail',cert?`${cert.subject.replaceAll('\n',' · ')} · Validade: ${new Date(cert.validTo).toLocaleDateString('pt-BR')}`:'Configure o A1 e-CNPJ ou e-CPF autorizado para este empregador.');
    $('certificateDisconnect').classList.toggle('hidden',!cert);
    const rep=await loadRepresentative(context);if(cert?.kind==='e-CPF'&&(!rep?.active||new Date(rep.validUntil)<=new Date()||rep.version!==cert.target?.representative?.version))setText('certificateState','Revisar autorização');
  }catch(error){try{assertOperationContext(context);setText('certificateMessage',error.message);}catch{}}
}
async function certificateAgent(action,jobId,context){
  const status=await getBiometricClient().discover();assertOperationContext(context);
  if(!status.certificatesAvailable)throw new Error('Instale a atualização do JP Biometria disponível em Biometria para usar certificados.');
  const controller=new AbortController();operationControllers.add(controller);const timer=setTimeout(()=>controller.abort(),190000);
  try{
    const response=await fetch(`http://127.0.0.1:${status.port}/api/certificate/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:getAuth().idToken,empresaId:context.empresa,...(jobId?{jobId}:{})}),credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',signal:controller.signal});
    const body=await response.json();assertOperationContext(context);if(!response.ok||body.ok===false)throw new Error(body.message||body.error||'A certificação não foi concluída.');return body;
  }finally{clearTimeout(timer);operationControllers.delete(controller);}
}
async function configureCompanyCertificate(){
  if(!activeEmpresaId){setText('certificateMessage','Selecione uma empresa.');return;}
  const context=operationContext(),button=$('certificateConfigure');if(button.disabled)return;button.disabled=true;
  setText('certificateMessage','Confira a janela do Windows para selecionar e autorizar o certificado.');
  try{await certificateAgent('configure','',context);assertOperationContext(context);setText('certificateMessage','Certificado configurado neste computador. As próximas fichas poderão ser certificadas após a biometria.');await loadCompanyCertificate();}
  catch(error){try{assertOperationContext(context);setText('certificateMessage',error.message);}catch{}}finally{button.disabled=false;}
}
async function disconnectCompanyCertificate(){
  const context=operationContext();if(!confirm('Desvincular o certificado desta empresa? Os documentos já certificados serão preservados.'))return;
  try{ensureSuccess(await api('/api/jpged/certificado/desvincular',{method:'POST',body:'{}'}));assertOperationContext(context);await loadCompanyCertificate();setText('certificateMessage','Certificado desvinculado do aplicativo. O certificado instalado no Windows foi preservado.');}
  catch(error){setText('certificateMessage',error.message);}
}
async function certifyFicha(id,preview,context=operationContext()){
  assertOperationContext(context);
  const message=text=>{if(preview&&!preview.closed)preview.document.getElementById('printSignatureStatus').textContent=text;};
  message('Biometria confirmada · Preparando o documento certificado...');
  const r=ensureSuccess(await api('/api/jpged/fichas/'+encodeURIComponent(id)+'/preparar',{method:'POST',body:'{}'}));assertOperationContext(context);
  if(!r.body.completed){message('Biometria confirmada · Assinando com o certificado da empresa...');await certificateAgent('sign',r.body.jobId,context);}
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

async function loadRepresentative(context=operationContext()){
  $('representativeForm').classList.toggle('hidden',!isMaster());
  const r=ensureSuccess(await api('/api/jpged/representante'));assertOperationContext(context);const rep=r.body.representative;
  const active=rep?.active&&new Date(rep.validUntil)>new Date();
  setText('representativeStatus',rep?`${rep.name} · CPF ${rep.cpf.slice(0,3)}.***.***-${rep.cpf.slice(-2)} · ${active?'Autorizado até '+new Date(rep.validUntil).toLocaleDateString('pt-BR'):'Autorização vencida ou revogada'}`:'Para usar e-CPF, solicite ao Master a conferência e autorização do titular ou representante.');
  if(isMaster())for(const [key,id] of [['name','representativeName'],['cpf','representativeCpf'],['capacity','representativeCapacity'],['reference','representativeReference'],['validUntil','representativeUntil']])$(id).value=key==='validUntil'?(rep?.[key]?.slice(0,10)||''):(rep?.[key]||(key==='capacity'?'titular':''));
  return rep;
}
async function saveRepresentative(event){
  event.preventDefault();if(!isMaster()||!activeEmpresaId)return;
  const context=operationContext(),button=event.target.querySelector('button[type="submit"]');if(button.disabled)return;button.disabled=true;
  try{const body=formDataObj(event.target);body.checked=event.target.elements.checked.checked;ensureSuccess(await api('/api/jpged/representante',{method:'POST',body:JSON.stringify(body)}));assertOperationContext(context);setText('certificateMessage','Autorização salva. Configure o e-CPF neste computador para vincular o certificado a ela.');await loadRepresentative(context);}
  catch(error){try{assertOperationContext(context);setText('certificateMessage',error.message);}catch{}}finally{button.disabled=false;}
}
async function revokeRepresentative(){
  if(!isMaster()||!activeEmpresaId||!confirm('Revogar o uso de e-CPF para novas certificações desta empresa? Os documentos existentes serão preservados.'))return;
  const context=operationContext();try{ensureSuccess(await api('/api/jpged/representante/revogar',{method:'POST',body:'{}'}));assertOperationContext(context);await loadRepresentative(context);setText('certificateMessage','Autorização revogada. Novas certificações com este e-CPF estão bloqueadas.');}catch(error){try{assertOperationContext(context);setText('certificateMessage',error.message);}catch{}}
}
