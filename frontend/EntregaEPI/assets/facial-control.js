// Master controls are persisted on the server; no new app release is needed to renew them.
let facialControlState=null,facialControlLoading=false;
function facialControlMessage(message,error=false){const n=$('facialControlMessage');if(n){n.textContent=message;n.className='message '+(error?'error':'success');}}
function facialLocalDate(iso){const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function renderFacialControl(state){
 facialControlState=state;
 setText('facialControlStatus',state.active?'Facial liberada':state.config.enabled?'Facial pausada por prazo, limite ou verificação':'Facial desativada');
 setText('facialPrivacyStatus',!state.infrastructureReady?'Configuração inicial da AWS pendente':state.privacy.ready?'Privacidade AWS verificada: uso para melhoria da IA desativado':'Não foi possível confirmar a proteção de privacidade na AWS');
 setText('facialCaptureUsage',state.usage?`${state.usage.total} captura(s) já utilizada(s). ${state.remaining} restante(s) na liberação atual.`:'Contagem disponível após a configuração inicial.');
 $('facialControlEnd').value=facialLocalDate(Date.parse(state.config.endAt)>Date.now()?state.config.endAt:new Date(Date.now()+7*86400000));
 $('facialControlRemaining').value=state.remaining>0?state.remaining:50;$('facialControlDaily').value=state.config.dailyLimit||20;
 $('facialCostsAccepted').checked=false;$('facialGovernanceAccepted').checked=false;
 $('facialControlSave').disabled=!state.infrastructureReady||!state.privacy.ready;$('facialControlPause').disabled=!state.config.enabled;
 updateFacialEstimate();
}
function updateFacialEstimate(){const n=Number($('facialControlRemaining')?.value||0);setText('facialCostEstimate',Number.isFinite(n)&&n>0?`Referência de análise AWS: até ${(n*.0221).toLocaleString('pt-BR',{style:'currency',currency:'USD'})} para ${n} captura(s), com os preços consultados em 30/10/2026. Armazenamento, tráfego e impostos à parte.`:'Informe a quantidade de capturas que deseja liberar.');}
async function loadFacialControl(){
 if(!isMaster()||!$('facialControlPanel')||facialControlLoading)return;facialControlLoading=true;const session=sessionGeneration;
 try{const r=ensureSuccess(await api('/api/sistema/facial'));if(session!==sessionGeneration||!isMaster())return;renderFacialControl(r.body);facialControlMessage('A ativação, pausa, validade e quantidade são alteradas aqui, sem atualizar o aplicativo.');}
 catch(error){if(session===sessionGeneration)facialControlMessage(error.message,true);}finally{facialControlLoading=false;}
}
async function saveFacialControl(enabled){
 if(!isMaster()||!facialControlState||facialControlLoading)return;
 const form=$('facialControlForm');if(enabled&&!form.reportValidity())return;
 const session=sessionGeneration,body={enabled,version:facialControlState.config.version,requestId:createRequestId()};
 if(enabled){Object.assign(body,{endAt:new Date($('facialControlEnd').value).toISOString(),remainingLimit:Number($('facialControlRemaining').value),dailyLimit:Number($('facialControlDaily').value),acknowledgeCosts:$('facialCostsAccepted').checked,acknowledgeGovernance:$('facialGovernanceAccepted').checked});}
 facialControlLoading=true;$('facialControlSave').disabled=$('facialControlPause').disabled=true;
 try{const r=ensureSuccess(await api('/api/sistema/facial',{method:'PUT',body:JSON.stringify(body)}));if(session!==sessionGeneration||!isMaster())return;renderFacialControl(r.body);facialControlMessage(enabled?'Liberação salva. Ao abrir uma ficha pendente, a opção facial usa esta configuração.':'Facial pausada. As assinaturas anteriores foram preservadas e a digital continua disponível.');}
 catch(error){if(session===sessionGeneration){facialControlMessage(error.message,true);$('facialControlSave').disabled=!facialControlState.infrastructureReady||!facialControlState.privacy.ready;$('facialControlPause').disabled=!facialControlState.config.enabled;}}
 finally{facialControlLoading=false;}
}
$('facialControlForm')?.addEventListener('submit',event=>{event.preventDefault();saveFacialControl(true);});
$('facialControlRemaining')?.addEventListener('input',updateFacialEstimate);
