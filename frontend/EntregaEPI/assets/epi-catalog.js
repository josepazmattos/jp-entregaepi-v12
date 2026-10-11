let existingEquipment=null,equipmentCheckGeneration=0;
function clearExistingEquipment(){
  equipmentCheckGeneration++;existingEquipment=null;
  $('epiUseExisting')?.classList.add('hidden');
  const button=$('epiForm')?.querySelector('button[type="submit"]');if(button)button.disabled=false;
}
function useCatalogEquipment(item){
  if(item.ambiguous||!requireEmpresa())return false;
  cache.epis=cache.epis.filter(e=>e.id!==item.id);cache.epis.push(item);
  renderEntregaOptions(true);$('entregaEpi').value=item.id;goScreen('entrega');$('entregaQuantidade').focus();return true;
}
async function checkExistingEquipment(){
  if($('epiSemCa').checked)return false;
  const ca=$('caInput').value.trim(),context=operationContext(),run=++equipmentCheckGeneration;
  if(!ca)return false;
  try{
    const r=ensureSuccess(await api('/api/epis/cadastrado/'+encodeURIComponent(ca)));assertOperationContext(context);
    if(run!==equipmentCheckGeneration||$('epiSemCa').checked||$('caInput').value.trim()!==ca)return true;
    existingEquipment=r.body.item||null;
    $('epiUseExisting').classList.toggle('hidden',!existingEquipment);
    $('epiForm').querySelector('button[type="submit"]').disabled=Boolean(existingEquipment);
    if(existingEquipment){$('caMessage').className='message success';$('caMessage').textContent='EPI já cadastrado';return true;}
    return false;
  }catch(error){
    if(run!==equipmentCheckGeneration)return true;
    try{assertOperationContext(context);$('caMessage').className='message error';$('caMessage').textContent=error.message;}catch{}
    return true;
  }
}
$('caInput').addEventListener('input',()=>{clearExistingEquipment();$('caMessage').className='message hidden';$('caMessage').textContent='';});
$('caInput').addEventListener('blur',()=>checkExistingEquipment());
$('epiUseExisting').addEventListener('click',()=>{if(existingEquipment)useCatalogEquipment(existingEquipment);});

function openEquipmentCatalog(target='catalogo'){
  const context=operationContext();
  const dialog=dialogShell(document,'Catálogo de EPIs','Busque por CA, nome, fabricante ou modelo.');dialog.classList.add('epi-catalog-dialog');
  const content=dialog.querySelector('.dialog-content');
  content.innerHTML='<form class="epi-catalog-filters"><div class="field"><label for="catalogQuery">Buscar equipamento</label><input id="catalogQuery" type="search" maxlength="160" placeholder="CA, nome, fabricante ou modelo"></div><div class="field"><label for="catalogOrigin">Origem</label><select id="catalogOrigin"><option value="all">Todos os equipamentos</option><option value="registered">Cadastrados manualmente</option><option value="report">Relatório CA</option><option value="without-ca">Sem CA</option></select></div><div class="field"><label for="catalogStatus">Situação do CA</label><select id="catalogStatus"><option value="all">Todas</option><option value="valido">Válido</option><option value="vencido">Vencido</option><option value="cancelado">Cancelado</option><option value="suspenso">Suspenso</option><option value="conferir dados">Dados divergentes</option></select></div></form><div id="epiCatalogRows" class="epi-catalog-rows" aria-live="polite"></div><div class="epi-catalog-pagination"><button type="button" id="catalogPrevious" class="btn btn-secondary">Anterior</button><span id="catalogPage" role="status"></span><button type="button" id="catalogNext" class="btn btn-secondary">Próxima</button></div>';
  const query=dialog.querySelector('#catalogQuery'),origin=dialog.querySelector('#catalogOrigin'),status=dialog.querySelector('#catalogStatus'),rows=dialog.querySelector('#epiCatalogRows'),previous=dialog.querySelector('#catalogPrevious'),next=dialog.querySelector('#catalogNext');
  query.value=target==='catalogo'?$('epiSearch').value:'';
  let page=1,pages=1,generation=0,timer,controller;
  function cancel(){clearTimeout(timer);controller?.abort();if(controller)operationControllers.delete(controller);}
  dialog.addEventListener('close',cancel,{once:true});
  async function load(){
    if(!dialog.isConnected||!dialog.open)return;
    cancel();controller=new AbortController();const currentController=controller,run=++generation;operationControllers.add(controller);previous.disabled=next.disabled=true;rows.textContent='Buscando equipamentos…';dialogMessage(dialog,'');
    try{
      const params=new URLSearchParams({q:query.value.trim(),page:String(page),origin:origin.value,status:status.value});
      const result=ensureSuccess(await api('/api/epis/catalogo?'+params,{signal:controller.signal}));assertOperationContext(context);if(!dialog.open||run!==generation)return;
      page=result.body.page;pages=result.body.pages;
      rows.innerHTML=result.body.items.length?result.body.items.map(item=>`<article class="epi-catalog-row"><div><strong>${escapeHtml(item.nomeCurto)}</strong><small>${escapeHtml(equipmentLabel(item))} · ${escapeHtml(item.fabricante||'Fabricante não informado')}</small>${item.modelo?`<small>Modelo: ${escapeHtml(item.modelo)}</small>`:''}${item.tamanho?`<small>Tamanho: ${escapeHtml(item.tamanho)}</small>`:''}<small>${escapeHtml(item.situacao||'')} ${item.validade?' · Validade: '+escapeHtml(item.validade):''}</small></div><div class="epi-catalog-actions"><span class="epi-catalog-origin">${item.origemCadastro==='relatorio_ca'?'Relatório CA':'Cadastrado'}</span><button type="button" class="btn btn-secondary" data-catalog-detail="${escapeHtml(item.id)}">Ver dados</button><button type="button" class="btn btn-primary" data-catalog-select="${escapeHtml(item.id)}" ${item.ambiguous?'disabled':''}>${item.ambiguous?'Conferir dados':target==='entrega'?'Selecionar':'Usar na entrega'}</button></div></article>`).join(''):'Nenhum equipamento encontrado neste filtro.';
      dialog.querySelector('#catalogPage').textContent=`Página ${page} de ${pages} · ${result.body.total.toLocaleString('pt-BR')} equipamentos`;previous.disabled=page<=1;next.disabled=page>=pages;
      rows.querySelectorAll('[data-catalog-detail]').forEach(button=>button.onclick=()=>action(button,false));
      rows.querySelectorAll('[data-catalog-select]').forEach(button=>button.onclick=()=>action(button,true));
    }catch(error){if(error.name==='AbortError'||run!==generation||!dialog.open)return;try{assertOperationContext(context);rows.textContent='Não foi possível consultar o catálogo.';dialogMessage(dialog,error.message,'error');}catch{}}
    finally{operationControllers.delete(currentController);}
  }
  async function action(button,select){
    if(button.disabled)return;button.disabled=true;const request=new AbortController();operationControllers.add(request);
    try{
      const id=button.dataset.catalogSelect||button.dataset.catalogDetail;
      const r=ensureSuccess(await api('/api/epis/catalogo/'+encodeURIComponent(id),{signal:request.signal}));assertOperationContext(context);if(!dialog.open)return;
      const item=r.body.item;
      if(select){
        if(item.ambiguous)throw new Error('Confira os dados divergentes e utilize o cadastro manual.');
        if(useCatalogEquipment(item))dialog.close();
      }else showEquipmentDetails(item);
    }catch(error){if(error.name!=='AbortError'&&dialog.open){try{assertOperationContext(context);dialogMessage(dialog,error.message,'error');}catch{}}}
    finally{operationControllers.delete(request);button.disabled=false;}
  }
  query.addEventListener('input',()=>{clearTimeout(timer);generation++;controller?.abort();timer=setTimeout(()=>{page=1;load();},250);});
  for(const select of [origin,status])select.onchange=()=>{page=1;load();};
  content.querySelector('form').onsubmit=event=>{event.preventDefault();page=1;load();};
  previous.onclick=()=>{if(page>1){page--;load();}};next.onclick=()=>{if(page<pages){page++;load();}};
  load();query.focus();
}
function showEquipmentDetails(item){
  const dialog=dialogShell(document,'Dados do equipamento',item.nomeCurto);dialog.classList.add('epi-catalog-detail');
  const fields=[['Tipo',equipmentLabel(item)],['Nome na ficha',item.nomeCurto],['Fabricante',item.fabricante],['Modelo / referência',item.modelo],['Tamanho',item.tamanho],['Validade do CA',item.validade],['Situação do CA',item.situacao]];
  dialog.querySelector('.dialog-content').innerHTML=`<dl class="epi-catalog-fields">${fields.map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value||'Não informado')}</dd></div>`).join('')}</dl><details class="epi-catalog-technical"><summary>Descrição técnica do CA</summary><p>${escapeHtml(item.descricao||'Não informada')}</p></details>${item.variants?`<p>O relatório contém dados divergentes para este CA. Confira as versões antes de preencher o cadastro manual.</p>${item.variants.map(v=>`<div class="item"><strong>${escapeHtml(v.nomeCurto)}</strong><small>${escapeHtml(v.fabricante)}</small><small>${escapeHtml(v.modelo)}</small><small>${escapeHtml(v.situacao)} · ${escapeHtml(v.validade)}</small></div>`).join('')}`:''}`;
}
