// Endereços consultados ao abrir a entrega; nunca durante o login ou a impressão histórica.
(() => {
 let state={company:'',data:null,promise:null,generation:0},choices={delivery:{},quick:{}};
 const el=id=>document.getElementById(id),workerId=p=>el(p==='delivery'?'entregaTrabalhador':'quickWorker')?.value||'';
 const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s*[-–—,/]\s*[a-z]{2}\s*$/i,'').trim().toLowerCase();
 const address=u=>[u.endereco,[u.cidade,u.uf].filter(Boolean).join('/'),u.cep?'CEP: '+u.cep:''].filter(Boolean).join(' · ');
 for(const [prefix,worker] of [['delivery','entregaTrabalhador'],['quick','quickWorker']]){
  const anchor=el(worker)?.closest('.field');if(!anchor)continue;
  const box=document.createElement('div');box.className='field span-two';box.innerHTML=`<label for="${prefix}Unit">Localidade / unidade</label><select id="${prefix}Unit" disabled><option value="">Carregue as unidades</option></select><p id="${prefix}UnitAddress" class="field-help"></p><p id="${prefix}UnitStatus" class="field-help" role="status" aria-live="polite"></p><div class="item-actions"><button id="${prefix}UnitRefresh" class="btn btn-secondary" type="button">Atualizar unidades</button><a class="text-button" href="https://www.jptreinamentos.com.br/jp-treinamentos/index.html" target="_blank" rel="noopener">Cadastro JP Treinamentos</a></div>`;
  anchor.insertAdjacentElement('afterend',box);
  el(prefix+'UnitRefresh').onclick=()=>load(true);
  el(prefix+'Unit').onchange=()=>{choices[prefix]={worker:workerId(prefix),selected:el(prefix+'Unit').value};if(prefix==='quick')el('quickConfirmed').checked=false;render(prefix);};
  el(worker).addEventListener('change',()=>workerChanged(prefix));
 }
 function render(prefix){
  const select=el(prefix+'Unit');if(!select)return;
  const data=state.company===activeEmpresaId?state.data:null;
  if(!data){select.disabled=true;select.innerHTML='<option value="">'+(state.promise?'Carregando unidades…':'Carregue as unidades')+'</option>';el(prefix+'UnitAddress').textContent='';return;}
  const items=data.items||[];select.disabled=!items.length;
  select.innerHTML=items.length?'<option value="">Selecione a unidade desta ficha</option>'+items.map(u=>`<option value="${escapeHtml(u.id)}" ${!u.endereco||!u.cidade?'disabled':''}>${escapeHtml(address(u))}</option>`).join(''):'<option value="">Endereço do cadastro da empresa</option>';
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
