// Endereços consultados ao abrir a entrega; nunca durante o login ou a impressão histórica.
(() => {
 let state={company:'',data:null,promise:null,generation:0},choices={delivery:{},quick:{}};
 const el=id=>document.getElementById(id),workerId=p=>el(p==='delivery'?'entregaTrabalhador':'quickWorker')?.value||'';
 const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s*[-–—,/]\s*[a-z]{2}\s*$/i,'').trim().toLowerCase();
 const address=u=>[u.endereco,[u.cidade,u.uf].filter(Boolean).join('/'),u.cep?'CEP: '+u.cep:''].filter(Boolean).join(' · ');
 for(const [prefix,worker] of [['delivery','entregaTrabalhador'],['quick','quickWorker']]){
  const anchor=el(worker)?.closest('.field');if(!anchor)continue;
  const box=document.createElement('div');box.className='field span-two';box.innerHTML=`<label for="${prefix}Unit">Localidade / unidade</label><select id="${prefix}Unit" disabled><option value="">Carregue as unidades</option></select><p id="${prefix}UnitAddress" class="field-help"></p><p id="${prefix}UnitStatus" class="field-help" role="status" aria-live="polite"></p><div class="item-actions"><button id="${prefix}UnitRefresh" class="btn btn-secondary" type="button">Atualizar unidades</button><button class="text-button unit-manage hidden" type="button">Editar localidades da empresa</button></div>`;
  anchor.insertAdjacentElement('afterend',box);
  el(prefix+'UnitRefresh').onclick=()=>load(true);
  box.querySelector('.unit-manage').onclick=()=>{if(isMaster())editCompany(activeEmpresaId);};
  el(prefix+'Unit').onchange=()=>{choices[prefix]={worker:workerId(prefix),selected:el(prefix+'Unit').value};if(prefix==='quick')el('quickConfirmed').checked=false;render(prefix);};
  el(worker).addEventListener('change',()=>workerChanged(prefix));
 }
 function render(prefix){
  const select=el(prefix+'Unit');if(!select)return;
  select.closest('.field').querySelector('.unit-manage')?.classList.toggle('hidden',!isMaster());
  const data=state.company===activeEmpresaId?state.data:null;
  if(!data){select.disabled=true;select.innerHTML='<option value="">'+(state.promise?'Carregando unidades…':'Carregue as unidades')+'</option>';el(prefix+'UnitAddress').textContent='';return;}
  const items=data.items||[];select.disabled=!items.length;
  select.innerHTML=items.length?'<option value="">Selecione a unidade desta ficha</option>'+items.map(u=>`<option value="${escapeHtml(u.id)}" ${!u.endereco||!u.cidade?'disabled':''}>${escapeHtml([u.cidade,u.uf].filter(Boolean).join('/')+' — '+u.endereco)}</option>`).join(''):'<option value="">Endereço do cadastro da empresa</option>';
  const prior=choices[prefix];select.value=items.some(u=>u.id===prior.selected)?prior.selected:'';
  const selected=items.find(u=>u.id===select.value),company=cache.empresas.find(x=>x.id===activeEmpresaId)||{};
  el(prefix+'UnitAddress').textContent=selected?address(selected):items.length?'Confira a unidade e o endereço antes de gerar a ficha.':[company.endereco,company.localidade,company.uf].filter(Boolean).join(' · ');
  el(prefix+'UnitStatus').textContent=items.length?'Endereços do JP Treinamentos'+(data.consultadoEm?' · Atualizados em '+new Date(data.consultadoEm).toLocaleString('pt-BR'):''):data.motivo||'Nenhuma unidade ativa vinculada a este CNPJ no JP Treinamentos. A ficha usará o endereço do cadastro da empresa.';
 }
 function workerChanged(prefix,force=false){
  const id=workerId(prefix);if(!force&&choices[prefix].worker===id){render(prefix);return;}
  const items=state.data?.items||[],worker=cache.trabalhadores.find(w=>w.id===id),matches=items.filter(u=>fold(u.cidade)===fold(worker?.localidade||worker?.city)&&u.cidade);
  const candidate=matches.length===1?matches[0]:items.length===1?items[0]:null;
  choices[prefix]={worker:id,selected:candidate?.endereco&&candidate?.cidade?candidate.id:''};render(prefix);
 }
 async function load(refresh=false){
  if(!activeEmpresaId)return;
  if(state.company!==activeEmpresaId)reset();
  if(state.promise)return state.promise;
  if(state.data&&!refresh){for(const p of ['delivery','quick'])workerChanged(p);return;}
  const context=operationContext(),generation=state.generation;state.company=activeEmpresaId;
  const task=(async()=>{
   for(const p of ['delivery','quick']){el(p+'UnitRefresh').disabled=true;el(p+'UnitStatus').textContent='Consultando unidades da empresa…';}
   try{
    const r=ensureSuccess(await api('/api/empresas/'+encodeURIComponent(context.empresa)+'/unidades'+(refresh?'/atualizar':''),refresh?{method:'POST',body:'{}'}:{}));assertOperationContext(context);if(generation!==state.generation)return;
    state.data=r.body;
    for(const p of ['delivery','quick']){
     const prior=choices[p];if(prior.worker===workerId(p)&&state.data.items.some(u=>u.id===prior.selected))render(p);else workerChanged(p,true);
    }
    if(refresh)el('quickConfirmed').checked=false;
   }catch(error){try{assertOperationContext(context);if(generation!==state.generation)return;state.data=null;for(const p of ['delivery','quick']){render(p);el(p+'UnitStatus').textContent=error.message||'Não foi possível consultar as unidades. Use Atualizar unidades.';}}catch{}}
   finally{if(generation===state.generation){state.promise=null;for(const p of ['delivery','quick'])el(p+'UnitRefresh').disabled=false;}}
  })();state.promise=task;for(const p of ['delivery','quick'])render(p);return task;
 }
 function read(prefix){
  if(state.company!==activeEmpresaId||!state.data||state.promise)throw new Error('Aguarde a consulta das unidades ou clique em Atualizar unidades.');
  const id=el(prefix+'Unit').value;
  if(state.data.items.length&&!state.data.items.some(u=>u.id===id&&u.endereco&&u.cidade))throw new Error('Selecione a unidade e confira o endereço desta ficha.');
  return {...(id?{unidadeId:id}:{}),...(state.data.version?{unidadeVersao:state.data.version}:{})};
 }
 function reset(){state={company:'',data:null,promise:null,generation:state.generation+1};choices={delivery:{},quick:{}};for(const p of ['delivery','quick']){render(p);if(el(p+'UnitStatus'))el(p+'UnitStatus').textContent='';if(el(p+'UnitRefresh'))el(p+'UnitRefresh').disabled=false;}}
 window.JP_UNIDADES={load,read,reset,workerChanged};
})();

// Localities are maintained inside company registration, using the shared registry.
(() => {
 const hosts=new WeakMap();
 function mount(form,items=[]){
  const section=document.createElement('section');section.className='company-units';
  section.innerHTML='<h3>Localidades / unidades</h3><p class="field-help">Cadastre os endereços que poderão ser escolhidos na entrega de EPI. Compartilhados com o JP Treinamentos pelo CNPJ. Alterações valem para novas fichas.</p><div class="company-unit-list"></div><button class="btn btn-secondary company-unit-add" type="button">+ Adicionar localidade / unidade</button>';
  const target=form.querySelector('.form-actions')||form.querySelector('button[type="submit"]');target.before(section);
  const rows=[],list=section.querySelector('.company-unit-list');hosts.set(form,{rows,section});
  function add(item=null){
   const data={id:item?.id||crypto.randomUUID(),revisao:item?.revisao||null,original:item?JSON.stringify(item):null,removed:false};
   const row=document.createElement('fieldset');row.className='company-unit-row';
   row.innerHTML='<legend>Localidade / unidade</legend><div class="field"><label>Localidade / nome da unidade<input data-unit-field="cidade" maxlength="120" required placeholder="Ex.: Dourados — Centro"></label></div><div class="grid-form"><div class="field"><label>UF<select data-unit-field="uf"><option value="">Selecione</option>'+('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').map(uf=>`<option>${uf}</option>`).join(''))+'</select></label></div><div class="field"><label>CEP<input data-unit-field="cep" inputmode="numeric" maxlength="9" pattern="[0-9]{5}-?[0-9]{3}" placeholder="00000-000"></label></div></div><div class="field"><label>Endereço completo<input data-unit-field="endereco" maxlength="300" required placeholder="Rua, número, complemento e bairro"></label></div><button class="text-button company-unit-remove" type="button"></button>';
   for(const field of row.querySelectorAll('[data-unit-field]'))field.value=item?.[field.dataset.unitField]||'';
   const button=row.querySelector('button');button.textContent=item?'Inativar unidade':'Remover da lista';
   button.onclick=()=>{
    if(!item){row.remove();rows.splice(rows.indexOf(data),1);return;}
    data.removed=!data.removed;row.classList.toggle('unit-inactive',data.removed);for(const field of row.querySelectorAll('input,select'))field.disabled=data.removed;
    button.textContent=data.removed?'Desfazer inativação (a unidade será retirada ao salvar)':'Inativar unidade';
   };
   data.row=row;rows.push(data);list.append(row);if(!item)row.querySelector('input').focus();
  }
  items.forEach(add);section.querySelector('.company-unit-add').onclick=()=>add();
  return section;
 }
 function changes(form){
  const host=hosts.get(form);if(!host)return [];
  return host.rows.flatMap(data=>{
   if(data.removed)return [{id:data.id,revisao:data.revisao,ativo:false}];
   const values=Object.fromEntries([...data.row.querySelectorAll('[data-unit-field]')].map(el=>[el.dataset.unitField,el.value.trim()]));
   if(values.cidade.length<2||values.endereco.length<5)throw new Error('Preencha a localidade e o endereço completo de cada unidade.');
   const original=data.original?JSON.parse(data.original):null;
   if(original&&Object.entries(values).every(([key,value])=>value===String(original[key]||'')))return [];
   return [{id:data.id,revisao:data.revisao,ativo:true,...values}];
  });
 }
 function reset(form){const host=hosts.get(form);if(host){host.section.remove();hosts.delete(form);}if(form)mount(form);}
 async function save(id,alteracoes){
  if(!alteracoes.length)return;
  if(!isMaster())throw new Error('Somente o Master pode cadastrar localidades.');
  const result=ensureSuccess(await api('/api/empresas/'+encodeURIComponent(id)+'/unidades',{method:'POST',body:JSON.stringify({alteracoes})}));
  window.JP_UNIDADES?.reset();return result.body;
 }
 const style=document.createElement('style');style.textContent='.company-units{margin:20px 0;padding-top:16px;border-top:1px solid #dbe7e1;min-width:0}.company-unit-row{margin:12px 0;padding:14px;border:1px solid #dbe7e1;border-radius:10px;min-width:0}.company-unit-row legend{font-weight:700;padding:0 6px}.company-unit-row label{display:block}.company-unit-row input,.company-unit-row select{width:100%;box-sizing:border-box;margin-top:6px}.company-unit-row.unit-inactive{background:#fff4ee}.company-unit-row.unit-inactive input,.company-unit-row.unit-inactive select{opacity:.55}.company-units h3{margin:0 0 8px}';document.head.append(style);
 window.JP_EMPRESA_UNIDADES={mount,changes,reset,save};
 const form=document.getElementById('empresaForm');if(form)mount(form);
})();
