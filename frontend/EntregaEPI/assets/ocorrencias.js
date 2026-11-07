// Occurrences are administrative records. They never become a delivery/return item.
(() => {
  const field=$('entregaTipo')?.closest('.field');if(!field)return;
  const box=document.createElement('div');box.className='span-two';
  box.innerHTML='<label><input type="checkbox" id="epiVale"> Vale de desconto — encaminhar ao RH</label><p class="field-help">Registre o EPI anterior perdido ou danificado. A reposição é feita normalmente.</p><button type="button" class="text-button" id="epiVales">Consultar vales</button><button type="button" class="text-button hidden" id="epiValeLink">Abrir vale do e-mail</button>';
  field.after(box);
  const reasons={perda:'Perda',extravio:'Extravio',dano:'Dano',mau_uso:'Suspeita de uso inadequado'};
  const pending=new Map();
  const money=value=>value==null?'Não informado':(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const mailLabel=item=>({pendente:'Aviso ao SAC pendente',enviando:'Envio em processamento',enviado:'E-mail enviado para os destinatários da empresa e SAC',falha:'Falha no envio; use Enviar aviso',conferir_envio:'Confira o recebimento no SAC antes de repetir o envio'})[item.email?.status]||'Aviso pendente';
  function button(dialog,label,action){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';b.textContent=label;b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await action();}catch(e){if(dialog.isConnected)dialogMessage(dialog,e.message,'error');}finally{b.disabled=false;}};dialog.querySelector('.dialog-actions').prepend(b);return b;}
  async function printSource(item,replacement=false){const context=operationContext(),r=ensureSuccess(await api(`/api/fichas/ocorrencias/${encodeURIComponent(item.id)}/ficha${replacement?'?reposicao=true':''}`));assertOperationContext(context);const f=r.body.item;cache.fichas=[f,...cache.fichas.filter(x=>x.id!==f.id)];imprimirFicha(f.id);}
  async function send(item,dialog,context){assertOperationContext(context);if(dialog.isConnected)dialogMessage(dialog,'Vale registrado. Enviando aviso para os e-mails cadastrados da empresa e SAC…');const r=ensureSuccess(await api(`/api/fichas/ocorrencias/${encodeURIComponent(item.id)}/notificar`,{method:'POST',body:'{}'}));assertOperationContext(context);if(dialog.isConnected)dialogMessage(dialog,mailLabel(r.body.item));return r.body.item;}
  async function show(id){
    if(!requireEmpresa())return;const context=operationContext(),r=ensureSuccess(await api('/api/fichas/ocorrencias/'+encodeURIComponent(id)));assertOperationContext(context);let item=r.body.item;
    const d=dialogShell(document,item.numero,item.trabalhadorNome+' · '+item.empresaNome),content=d.querySelector('.dialog-content');
    content.innerHTML=`<p><b>EPI anterior:</b> ${escapeHtml(item.equipamento)} · CA: ${escapeHtml(item.ca)} · Quantidade: ${item.quantidade}</p><p><b>Entrega original:</b> ${escapeHtml(item.fichaNumero)}</p><p><b>Motivo:</b> ${escapeHtml(reasons[item.motivo])} · ${escapeHtml(item.data)}</p><p style="white-space:pre-wrap">${escapeHtml(item.descricao)}</p><p><b>EPI recolhido:</b> ${item.recolhido?'Sim':'Não'} · <b>Valor para análise:</b> ${escapeHtml(money(item.valorCentavos))}</p>${item.manifestacao?`<p><b>Manifestação do trabalhador:</b> ${escapeHtml(item.manifestacao)}</p>`:''}${item.evidencias?`<p><b>Referência das evidências:</b> ${escapeHtml(item.evidencias)}</p>`:''}<p><b>Situação:</b> Pendente de análise do RH. O registro não autoriza desconto automático.</p><p><b>Reposição:</b> ${escapeHtml(item.reposicaoNumero||'Ainda não vinculada')}</p>`;
    button(d,'Ficha original',()=>printSource(item));if(item.reposicaoFichaId)button(d,'Ficha de reposição',()=>printSource(item,true));
    else {
      const choices=cache.fichas.filter(f=>f.id!==item.fichaId&&f.empresaId===item.empresaId&&f.trabalhadorId===item.trabalhadorId&&f.status!=='cancelada'&&f.itens?.some(i=>['Entrega','Troca'].includes(i.tipoMovimentacao||f.tipo||'Entrega')));
      const select=document.createElement('select');select.setAttribute('aria-label','Ficha de reposição');select.innerHTML='<option value="">Selecione a nova entrega</option>'+choices.map(f=>`<option value="${escapeHtml(f.id)}">${escapeHtml(f.numero||f.id)} · ${escapeHtml(f.data)}</option>`).join('');content.append(select);
      button(d,'Vincular reposição',async()=>{assertOperationContext(context);if(!select.value)throw new Error('Selecione a ficha de reposição.');ensureSuccess(await api(`/api/fichas/ocorrencias/${encodeURIComponent(item.id)}/reposicao`,{method:'POST',body:JSON.stringify({fichaId:select.value})}));assertOperationContext(context);d.close();await show(id);});
    }
    if(['pendente','falha'].includes(item.email?.status))button(d,'Enviar aviso ao SAC',async()=>{item=await send(item,d,context);});
    dialogMessage(d,mailLabel(item));
  }
  async function list(){
    if(!requireEmpresa())return;const context=operationContext(),r=ensureSuccess(await api('/api/fichas/ocorrencias'));assertOperationContext(context);
    const d=dialogShell(document,'Vales de desconto','Registros administrativos para análise do RH.'),content=d.querySelector('.dialog-content');
    content.innerHTML=r.body.items.map(i=>`<p><button type="button" class="text-button" data-vale="${escapeHtml(i.id)}">${escapeHtml(i.numero)} · ${escapeHtml(i.trabalhadorNome)}</button><br>${escapeHtml(i.equipamento)} · ${escapeHtml(i.data)} · ${escapeHtml(mailLabel(i))}</p>`).join('')||'<p>Nenhum vale registrado para esta empresa.</p>';
    content.onclick=event=>{const id=event.target.closest('[data-vale]')?.dataset.vale;if(id){assertOperationContext(context);show(id).catch(e=>dialogMessage(d,e.message,'error'));}};
  }
  function register(){
    if(!requireEmpresa())return;const context=operationContext(),worker=$('entregaTrabalhador').value,epi=$('entregaEpi').value;
    if(!worker)throw new Error('Selecione o trabalhador.');
    if(entregaItems.some(i=>i.tipoMovimentacao==='Devolução'&&(!epi||i.epiId===epi)))throw new Error('Remova o EPI anterior da lista de devoluções antes de transformá-lo em vale.');
    const origins=cache.fichas.filter(f=>f.empresaId===context.empresa&&f.trabalhadorId===worker&&f.status!=='cancelada').flatMap(f=>(f.itens||[]).map((item,indice)=>({f,item,indice}))).filter(o=>['Entrega','Troca'].includes(o.item.tipoMovimentacao||o.f.tipo||'Entrega')&&(!epi||o.item.epiId===epi));
    const d=dialogShell(document,'Vale de desconto — análise do RH','Selecione a entrega do EPI anterior. Perda e extravio não serão registrados como devolução física.');
    if(!origins.length){dialogMessage(d,'Nenhuma entrega anterior encontrada para o trabalhador e equipamento selecionados. Confira o histórico ou limpe a seleção de equipamento.');return d;}
    d.querySelector('.dialog-content').innerHTML=`<form id="valeForm" class="grid-form"><div class="field span-two"><label for="valeOrigem">EPI e entrega de origem</label><select id="valeOrigem" required>${origins.map((o,i)=>`<option value="${i}">${escapeHtml(o.f.numero||o.f.id)} · ${escapeHtml(o.f.data)} · ${escapeHtml(o.item.epiNome||o.item.epiDescricao)} · Qtd.: ${o.item.quantidade}</option>`).join('')}</select></div><div class="field"><label for="valeQty">Quantidade</label><input id="valeQty" type="number" min="1" step="1" value="1" required></div><div class="field"><label for="valeData">Data da ocorrência</label><input id="valeData" type="date" required></div><div class="field"><label for="valeMotivo">Motivo relatado</label><select id="valeMotivo">${Object.entries(reasons).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></div><div class="field"><label for="valeValor">Valor total para análise (R$, opcional)</label><input id="valeValor" type="number" min="0" max="1000000" step="0.01"></div><div class="field span-two"><label for="valeRelato">Relato da ocorrência</label><textarea id="valeRelato" maxlength="2000" required></textarea></div><div class="field span-two"><label for="valeManifestacao">Manifestação do trabalhador (opcional)</label><textarea id="valeManifestacao" maxlength="2000"></textarea></div><div class="field span-two"><label for="valeEvidencias">Referência de fotos ou documentos (opcional)</label><textarea id="valeEvidencias" maxlength="2000"></textarea></div><label class="span-two"><input type="checkbox" id="valeRecolhido"> EPI danificado recolhido fisicamente</label><p class="field-help span-two">O aviso será enviado aos e-mails do cadastro da empresa, com cópia para sac@jptreinamentos.com.br. Sem e-mail cadastrado, o SAC receberá o aviso. A decisão sobre desconto depende de apuração; a reposição do EPI segue normalmente.</p></form>`;
    const form=d.querySelector('form'),get=id=>d.querySelector('#'+id);get('valeData').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Campo_Grande'});
    const sync=()=>{get('valeQty').max=origins[Number(get('valeOrigem').value)].item.quantidade;const lost=['perda','extravio'].includes(get('valeMotivo').value);get('valeRecolhido').disabled=lost;if(lost)get('valeRecolhido').checked=false;};get('valeOrigem').onchange=sync;get('valeMotivo').onchange=sync;sync();
    let requestId=createRequestId(),requestBody='';form.oninput=()=>{requestId=createRequestId();requestBody='';};form.onsubmit=e=>e.preventDefault();
    const save=button(d,'Registrar vale e avisar o RH',async()=>{
      assertOperationContext(context);if(!form.reportValidity())return;
      const origin=origins[Number(get('valeOrigem').value)],payload={indice:origin.indice,quantidade:Number(get('valeQty').value),data:get('valeData').value,motivo:get('valeMotivo').value,descricao:get('valeRelato').value,manifestacao:get('valeManifestacao').value,evidencias:get('valeEvidencias').value,recolhido:get('valeRecolhido').checked,valorCentavos:get('valeValor').value===''?null:Math.round(Number(get('valeValor').value)*100)};
      requestBody=JSON.stringify({...payload,requestId});for(const node of form.elements)node.disabled=true;
      let result;
      try{result=ensureSuccess(await api(`/api/fichas/${encodeURIComponent(origin.f.id)}/ocorrencias`,{method:'POST',body:requestBody}));}catch(e){for(const node of form.elements)node.disabled=false;sync();throw e;}
      assertOperationContext(context);const item=result.body.item;pending.set(item.id,{empresa:context.empresa,worker});save.remove();button(d,'Consultar vale',()=>show(item.id));
      // The previous item becomes an occurrence, not a fictitious return in the new ficha.
      if($('entregaTipo').value==='Devolução'){$('entregaTipo').value='Entrega';$('entregaTipo').dispatchEvent(new Event('change'));$('entregaEpi').value='';$('entregaQuantidade').value='1';}
      await send(item,d,context).catch(e=>{if(d.isConnected)dialogMessage(d,'Vale registrado. Aviso pendente: '+e.message,'error');});
    });
    return d;
  }
  $('epiVale').onchange=()=>{if(!$('epiVale').checked)return;try{const dialog=register();if(dialog)dialog.addEventListener('close',()=>{$('epiVale').checked=false;},{once:true});else $('epiVale').checked=false;}catch(e){$('epiVale').checked=false;handleAppError(e);}};
  $('epiVales').onclick=()=>list().catch(handleAppError);
  const params=new URLSearchParams(location.search),linked=params.get('vale');
  if(linked&&/^[a-f0-9-]{36}$/i.test(linked)){$('epiValeLink').classList.remove('hidden');$('epiValeLink').onclick=()=>{if(params.get('empresa')!==activeEmpresaId){handleAppError(new Error('Selecione a empresa indicada no e-mail para abrir este vale.'));return;}show(linked).catch(handleAppError);};}
  async function linkReplacement(ficha){
    const context=operationContext();
    for(const [id,p] of pending){if(p.empresa!==context.empresa||p.worker!==ficha.trabalhadorId)continue;
      try{ensureSuccess(await api(`/api/fichas/ocorrencias/${encodeURIComponent(id)}/reposicao`,{method:'POST',body:JSON.stringify({fichaId:ficha.id})}));assertOperationContext(context);pending.delete(id);}catch(e){try{assertOperationContext(context);handleAppError(new Error('A entrega foi salva. Vincule a reposição em Consultar vales: '+e.message));}catch{}}
    }
  }
  window.JP_OCORRENCIAS=Object.freeze({show,list,linkReplacement,reset(){pending.clear();}});
})();
