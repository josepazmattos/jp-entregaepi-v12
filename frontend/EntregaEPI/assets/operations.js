// Editors and biometric operations remain scoped to the authenticated company/session.
let workerEdit=null;
const operationWindows=new Set(),operationDialogs=new Set(),operationControllers=new Set();
function closeOperations(){
  const editing=Boolean(workerEdit);workerEdit=null;
  const form=$('trabalhadorForm');if(form&&editing){form.reset();setText('workerFormTitle','Novo trabalhador');$('workerEditCancel')?.classList.add('hidden');}
  for(const controller of operationControllers)controller.abort();operationControllers.clear();
  for(const dialog of operationDialogs)dialog.remove();operationDialogs.clear();
  for(const preview of operationWindows)if(!preview.closed)preview.close();operationWindows.clear();
}
function operationContext(){return {session:sessionGeneration,company:companyGeneration,empresa:activeEmpresaId};}
function assertOperationContext(context){if(!getAuth()||context.session!==sessionGeneration||context.company!==companyGeneration||context.empresa!==activeEmpresaId)throw new Error('A sessão ou a empresa mudou. Abra novamente este cadastro.');}
function dialogShell(doc,title,intro){
  const dialog=doc.createElement('dialog');dialog.className='jp-dialog';
  dialog.innerHTML=`<h2>${escapeHtml(title)}</h2><p>${escapeHtml(intro)}</p><div class="dialog-content"></div><div class="dialog-message" role="status" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="btn btn-secondary dialog-close">Fechar</button></div>`;
  doc.body.appendChild(dialog);operationDialogs.add(dialog);dialog.querySelector('.dialog-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{operationDialogs.delete(dialog);dialog.remove();});dialog.showModal();return dialog;
}
function dialogMessage(dialog,message,type=''){const node=dialog.querySelector('.dialog-message');node.textContent=message;node.className='dialog-message '+type;}
function editWorker(id){
  const item=cache.trabalhadores.find(x=>x.id===id);if(!item||String(item.empresaId)!==String(activeEmpresaId))return;
  workerEdit={id,version:item._version||1,...operationContext()};
  const form=$('trabalhadorForm');for(const field of form.elements)if(field.name)field.value=item[field.name]??(field.name==='nomeCompleto'?item.nome||'':'');
  setText('workerFormTitle','Editar trabalhador');$('workerEditCancel').classList.remove('hidden');form.scrollIntoView({block:'start',behavior:'smooth'});$('trabalhadorNome').focus({preventScroll:true});
}
function cancelWorkerEdit(){workerEdit=null;$('trabalhadorForm').reset();setText('workerFormTitle','Novo trabalhador');$('workerEditCancel').classList.add('hidden');}
async function submitWorker(event){
  if(!workerEdit)return submitCadastro(event,'/api/trabalhadores',true);
  event.preventDefault();const context=workerEdit,form=event.target,button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;
  try{assertOperationContext(context);ensureSuccess(await api('/api/trabalhadores/'+encodeURIComponent(context.id),{method:'PATCH',body:JSON.stringify({...formDataObj(form),_version:context.version})}));assertOperationContext(context);cancelWorkerEdit();await refreshTrabalhadores(false);setText('appMessage','Dados do trabalhador atualizados.');$('appMessage').className='message success';}
  catch(error){handleAppError(error);}finally{button.disabled=false;}
}
function editCompany(id){
  const item=cache.empresas.find(x=>x.id===id);if(!item)return;
  const context=operationContext(),dialog=dialogShell(document,'Editar empresa',item.nome||'Empresa selecionada');
  const fields=[['nome','Nome da empresa'],['localidade','Localidade'],['uf','UF'],['responsavel','Responsável'],['email','E-mail'],['telefone','Telefone']];
  dialog.querySelector('.dialog-content').innerHTML='<form id="companyEditForm">'+fields.map(([key,label])=>`<label for="company-edit-${key}">${label}</label><input id="company-edit-${key}" name="${key}" value="${escapeHtml(item[key]||'')}" ${key==='nome'?'required':''} ${key==='uf'?'maxlength="2"':''}>`).join('')+`<p class="field-help">CNPJ: ${escapeHtml(item.cnpj)} · Login: ${escapeHtml(item.login||'—')}</p><button type="submit" class="btn btn-primary" style="margin-top:16px">Salvar alterações</button></form>`;
  const form=dialog.querySelector('form');form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
    try{assertOperationContext(context);ensureSuccess(await api('/api/empresas/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({...Object.fromEntries(new FormData(form)),_version:item._version||1})}));assertOperationContext(context);await refreshEmpresas(false);dialog.close();}
    catch(error){dialogMessage(dialog,error.message,'error');}finally{button.disabled=false;}
  };
}
function deleteCompany(id){
  if(!isMaster())return;
  const item=cache.empresas.find(x=>x.id===id);if(!item)return;
  const context=operationContext(),dialog=dialogShell(document,'Excluir empresa',item.nome);
  dialog.querySelector('.dialog-content').innerHTML='<p>A empresa sairá da lista ativa e seu acesso será bloqueado. Os trabalhadores e as fichas já emitidas serão preservados no histórico. As fichas são registros de entrega e não movimentam estoque.</p><p>Salve no seu Drive os documentos que desejar antes de continuar.</p><label for="companyDeleteName">Digite o nome da empresa para confirmar</label><input id="companyDeleteName" autocomplete="off">';
  const button=document.createElement('button');button.className='btn btn-danger';button.textContent='Confirmar exclusão';dialog.querySelector('.dialog-actions').prepend(button);
  button.onclick=async()=>{if(button.disabled)return;button.disabled=true;
    try{assertOperationContext(context);ensureSuccess(await api('/api/empresas/'+encodeURIComponent(id),{method:'DELETE',body:JSON.stringify({_version:item._version||1,confirmacao:dialog.querySelector('input').value})}));assertOperationContext(context);dialog.close();await refreshAll();setText('appMessage','Empresa excluída. Documentos preservados no histórico.');$('appMessage').className='message success';}
    catch(error){if(dialog.isConnected)dialogMessage(dialog,error.message,'error');else handleAppError(error);button.disabled=false;}
  };
}
async function loadBiometricGallery(dialog,worker,context){
  const gallery=dialog.querySelector('.bio-gallery');if(!gallery)return;
  gallery.textContent='Carregando digitais cadastradas…';
  try{
    const result=ensureSuccess(await api('/api/trabalhadores/'+encodeURIComponent(worker.id)+'/biometrias'));assertOperationContext(context);if(!dialog.isConnected)return;
    const items=result.body.items||[];
    gallery.innerHTML=items.length?items.map(item=>`<article class="bio-card"><div class="bio-card-image">${/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(item.imageDataUrl||'')?`<img src="${escapeHtml(item.imageDataUrl)}" alt="Digital cadastrada: ${escapeHtml(fingerLabel(item.fingerCode))}">`:'<span>Imagem não armazenada<br><small>Recadastre para obter a miniatura</small></span>'}</div><strong>${escapeHtml(fingerLabel(item.fingerCode))}</strong><small>Cadastrada em ${escapeHtml(new Date(item.enrolledAt).toLocaleDateString('pt-BR'))}</small><button type="button" class="btn btn-secondary" data-recapture="${escapeHtml(item.fingerCode)}">Recadastrar</button></article>`).join(''):'<p>Nenhuma digital cadastrada.</p>';
    gallery.querySelectorAll('[data-recapture]').forEach(button=>button.onclick=()=>{const select=dialog.querySelector('#operationFinger'),capture=dialog.querySelector('#enrollFingerprint');if(select.disabled)return;select.value=button.dataset.recapture;capture.disabled=false;capture.textContent='Cadastrar digital';select.focus();dialogMessage(dialog,'Dedo selecionado. Para salvar a miniatura, use JP Biometria 12.9.2 ou superior (Sistema → Biometria). Clique em Cadastrar digital para fazer uma nova captura.');});
  }catch(error){if(dialog.isConnected)gallery.textContent=error.message||'Não foi possível carregar as imagens.';}
}
function fingerLabel(code){return window.JP_BIOMETRIA.FINGERS.find(x=>x[0]===code)?.[1]||code;}
function workerBiometrics(id){
  const worker=cache.trabalhadores.find(x=>x.id===id);if(!worker||String(worker.empresaId)!==String(activeEmpresaId))return;
  const dialog=dialogShell(document,'Digitais do trabalhador',worker.nomeCompleto||worker.nome||'Trabalhador');
  renderBiometricDialog(dialog,worker,null);
  loadBiometricGallery(dialog,worker,operationContext());
}
function renderBiometricDialog(dialog,worker,ficha){
  const context=operationContext(),content=dialog.querySelector('.dialog-content'),entries=Object.keys(worker.biometrias||{}),kind=ficha?'verify':'enroll';
  const fingers=ficha?window.JP_BIOMETRIA.FINGERS.filter(x=>entries.includes(x[0])):window.JP_BIOMETRIA.FINGERS;
  const company=cache.empresas.find(x=>String(x.id)===String(activeEmpresaId));
  content.innerHTML=`<p><strong>${escapeHtml(company?.nome||'Empresa selecionada')}</strong>${ficha?'<br>Ficha: '+escapeHtml(ficha.numero||ficha.id):''}</p>${ficha?'':'<div class="bio-gallery" aria-live="polite"></div>'}<div class="bio-summary">${entries.length?entries.map(code=>'<span>'+escapeHtml(fingerLabel(code))+' cadastrado</span>').join(''):'<span>Nenhuma digital cadastrada</span>'}</div><label for="operationFinger">Dedo utilizado</label><select id="operationFinger">${fingers.map(([code,label])=>`<option value="${code}">${label}</option>`).join('')}</select><p>${ficha?'A digital será comparada com o cadastro deste dedo. A assinatura só será concluída se houver correspondência.':'Selecione o dedo e posicione-o no leitor quando a luz acender. O cadastro ficará vinculado a este trabalhador e à empresa, disponível para as próximas entregas.'}</p>`;
  const button=dialog.ownerDocument.createElement('button');button.type='button';button.className='btn btn-primary';button.id=ficha?'verifyFingerprint':'enrollFingerprint';button.textContent=ficha?'Capturar e assinar':'Cadastrar digital';dialog.querySelector('.dialog-actions').prepend(button);
  if(ficha&&!entries.length){button.disabled=true;content.querySelector('select').disabled=true;dialogMessage(dialog,'Cadastre uma digital em Trabalhadores → Digitais antes de assinar.','error');return;}
  if(!ficha)content.querySelector('.bio-summary').remove();
  let completedBody=null;
  if(!ficha)content.querySelector('select').onchange=()=>{if(!completedBody&&!content.querySelector('select').disabled){button.disabled=false;button.textContent='Cadastrar digital';}};
  button.onclick=async()=>{
    if(button.disabled)return;
    const fingerCode=content.querySelector('select').value;
    if(!ficha&&entries.includes(fingerCode)&&!dialog.ownerDocument.defaultView.confirm('Substituir o cadastro do '+fingerLabel(fingerCode)+' deste trabalhador?'))return;
    const controller=new AbortController();operationControllers.add(controller);
    const abort=()=>controller.abort();dialog.addEventListener('close',abort,{once:true});
    button.disabled=true;content.querySelector('select').disabled=true;
    try{
      assertOperationContext(context);
      if(!completedBody){
        dialogMessage(dialog,'Localizando o leitor. Aguarde...');
        const client=getBiometricClient(),base=ficha?'/api/fichas/'+encodeURIComponent(ficha.id):'/api/trabalhadores/'+encodeURIComponent(worker.id);
        // Independent preparation only. Capture starts after BOTH checks succeed.
        const prepared=await Promise.allSettled([
          client.discover({signal:controller.signal}).then(status=>{if(!status.ready)throw window.JP_BIOMETRIA.unavailableError(status);if(!status.verificationAvailable)throw new Error('Atualize o JP Biometria em Sistema → Biometria para cadastrar e comparar digitais.');return status;}),
          api(base+'/biometria/desafio',{method:'POST',body:JSON.stringify({fingerCode}),signal:controller.signal}).then(ensureSuccess)
        ]);assertOperationContext(context);
        const failed=prepared.find(result=>result.status==='rejected');if(failed)throw failed.reason;
        const start=prepared[1].value;
        dialogMessage(dialog,'Posicione o '+fingerLabel(fingerCode).toLocaleLowerCase('pt-BR')+' no leitor. Aguarde a captura e a conferência.');
        const response=await client.biometric(start.body.challenge,{signal:controller.signal});assertOperationContext(context);
        if(controller.signal.aborted)throw new Error('Operação cancelada.');
        completedBody={...response,challengeId:start.body.challenge.challengeId};
      }
      dialogMessage(dialog,ficha?'Correspondência confirmada pelo leitor. Salvando a assinatura...':'Salvando o cadastro da digital...');
      const target=ficha?'/api/fichas/'+encodeURIComponent(ficha.id)+'/assinar':'/api/trabalhadores/'+encodeURIComponent(worker.id)+'/biometria';
      const result=ensureSuccess(await api(target,{method:'POST',body:JSON.stringify(completedBody),signal:controller.signal}));assertOperationContext(context);
      if(ficha){
        const item=result.body?.item;if(item?.id!==ficha.id||item.assinaturaBiometrica?.verificada!==true)throw new Error('O sistema não confirmou a assinatura desta ficha.');
        cache.fichas=cache.fichas.map(x=>x.id===item.id?item:x);renderFichas();renderDashboard();
        updatePrintWindow(dialog.ownerDocument.defaultView,item);
        dialog.close();
      }else{
        await refreshTrabalhadores(false);assertOperationContext(context);await loadBiometricGallery(dialog,worker,context);if(!entries.includes(fingerCode))entries.push(fingerCode);dialogMessage(dialog,'Digital cadastrada. Ela já pode ser usada nas próximas entregas.','success');
        button.textContent='Concluído';button.disabled=true;completedBody=null;
      }
    }catch(error){
      if(!dialog.isConnected||controller.signal.aborted)return;
      dialogMessage(dialog,error.message||'Não foi possível concluir a operação.','error');
      if(error.status&&error.status<500&&error.status!==408){completedBody=null;}
      button.textContent=completedBody?'Tentar salvar novamente':ficha?'Capturar e assinar':'Cadastrar digital';button.disabled=false;
    }finally{
      operationControllers.delete(controller);dialog.removeEventListener('close',abort);
      if(!completedBody)content.querySelector('select').disabled=false;
    }
  };
}
function printToolbarCSS(){return `.print-toolbar{position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:center;padding:14px;background:#f0f6f2;border-bottom:1px solid #d6e3db;font:14px Arial,sans-serif;margin-bottom:18px;z-index:2;flex-wrap:wrap}.print-toolbar button,.jp-dialog button{border:1px solid #c6d8cd;border-radius:8px;padding:12px 16px;background:#fff;color:#174c35;cursor:pointer;font-weight:bold}.print-toolbar button.primary,.jp-dialog .btn-primary{background:#078448;color:white}.print-toolbar button:disabled{opacity:.55;cursor:default}.jp-dialog{border:0;border-radius:16px;padding:28px;width:min(660px,90vw);max-height:90vh;font:15px/1.5 Arial,sans-serif;color:#183d31}.jp-dialog::backdrop{background:#173a2c88}.jp-dialog select{display:block;width:100%;padding:12px;border:1px solid #c4d8cd;border-radius:8px;margin:8px 0}.jp-dialog .dialog-actions{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}.jp-dialog .dialog-message{margin-top:16px;white-space:pre-line}.jp-dialog .error{color:#a23126}.bio-summary{display:flex;gap:8px;flex-wrap:wrap;font-size:12px}.bio-summary span{background:#eaf4ed;border-radius:12px;padding:5px 9px}@media print{.print-toolbar,.jp-dialog{display:none!important}body{padding:0!important}}`;}
function setupPrintWindow(preview,ficha,context){
  const doc=preview.document,style=doc.createElement('style');style.textContent=printToolbarCSS();doc.head.appendChild(style);
  const toolbar=doc.createElement('div');toolbar.className='print-toolbar';toolbar.innerHTML='<span id="printSignatureStatus"></span><button id="signDocument" class="primary" type="button">Assinar biometricamente</button><button id="printDocument" type="button">Imprimir</button>';doc.body.prepend(toolbar);
  toolbar.querySelector('#printDocument').onclick=()=>preview.print();
  toolbar.querySelector('#signDocument').onclick=async()=>{
    try{assertOperationContext(context);const result=ensureSuccess(await api('/api/fichas/'+encodeURIComponent(ficha.id)+'/assinatura-contexto'));assertOperationContext(context);
      const current=result.body.ficha,worker=result.body.worker;
      if(current?.id!==ficha.id||current?.empresaId!==context.empresa||worker?.id!==current.trabalhadorId||worker?.empresaId!==context.empresa)throw new Error('O cadastro não corresponde à ficha selecionada.');
      cache.fichas=cache.fichas.map(x=>x.id===current.id?current:x);cache.trabalhadores=cache.trabalhadores.map(x=>x.id===worker.id?worker:x);
      if(!current||!canSignFicha(current)){if(current)updatePrintWindow(preview,current);throw new Error('Esta ficha não está pendente. Confira a situação atual.');}
      if(!worker)throw new Error('Cadastro do trabalhador não localizado.');
      const dialog=dialogShell(doc,'Assinar biometricamente',current.trabalhadorSnapshot?.nomeCompleto||current.trabalhadorNome||worker.nomeCompleto);renderBiometricDialog(dialog,worker,current);
    }catch(error){toolbar.querySelector('#printSignatureStatus').textContent=error.message;}
  };
  updatePrintWindow(preview,ficha);operationWindows.add(preview);preview.addEventListener('pagehide',()=>operationWindows.delete(preview),{once:true});
}
function updatePrintWindow(preview,ficha){
  if(preview.closed)return;const doc=preview.document;
  const empresa=cache.empresas.find(x=>String(x.id)===String(ficha.empresaId))||{},worker=cache.trabalhadores.find(x=>x.id===ficha.trabalhadorId)||{};
  const html=window.JP_FICHA.buildDocument(ficha,empresa,worker,cache.epis,{defaultLogo:document.querySelector('.brand-logo')?.src});
  const parsed=new DOMParser().parseFromString(html,'text/html');doc.querySelector('main.sheet')?.replaceWith(doc.importNode(parsed.querySelector('main.sheet'),true));
  doc.getElementById('signDocument').disabled=!canSignFicha(ficha);doc.getElementById('printSignatureStatus').textContent=fichaStatus(ficha);
}
function canSignFicha(ficha){return ficha?.status==='pendente'||ficha?.status==='assinada'&&ficha.assinaturaBiometrica?.verificada!==true;}
function fichaStatus(ficha){return ficha.status==='cancelada'?'Excluída / cancelada':ficha.status==='assinada'?(ficha.assinaturaBiometrica?.verificada===true?'Assinada biometricamente':'Assinada — registro anterior sem conferência'):'Não assinada';}
function deleteFicha(id){
  const ficha=cache.fichas.find(x=>x.id===id);if(!ficha)return;
  const context=operationContext(),signed=ficha.status==='assinada'||Boolean(ficha.assinaturaBiometrica);
  const dialog=dialogShell(document,'Excluir ficha',ficha.numero||id);
  dialog.querySelector('.dialog-content').innerHTML=signed?'<p>A ficha assinada será cancelada e retirada da lista ativa, mantendo o histórico.</p><label for="deleteReason">Motivo da exclusão</label><input id="deleteReason" maxlength="2000" required>':'<p>Excluir esta ficha que ainda não foi assinada?</p>';
  const button=document.createElement('button');button.className='btn btn-danger';button.textContent='Confirmar exclusão';dialog.querySelector('.dialog-actions').prepend(button);
  button.onclick=async()=>{if(button.disabled)return;const motivo=dialog.querySelector('input')?.value.trim()||'';if(signed&&!motivo){dialogMessage(dialog,'Informe o motivo da exclusão.','error');return;}button.disabled=true;
    try{assertOperationContext(context);ensureSuccess(await api('/api/fichas/'+encodeURIComponent(id),{method:'DELETE',body:JSON.stringify({motivo})}));await refreshFichas(false);assertOperationContext(context);dialog.close();renderDashboard();}
    catch(error){dialogMessage(dialog,error.message,'error');button.disabled=false;}
  };
}
