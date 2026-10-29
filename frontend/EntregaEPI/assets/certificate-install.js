// A1 administration is independent of the native biometric agent.
let certificateCleanup=null;
const certificateWorkerURL=new URL('certificate-worker.js?v=20261011-cert1',document.currentScript.src);
function certificateWorker(){
  const worker=new Worker(certificateWorkerURL);
  let next=0,closed=false;const pending=new Map();
  const close=()=>{closed=true;worker.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Instalação encerrada.'));}pending.clear();};
  worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};
  worker.onerror=()=>{for(const p of pending.values())p.reject(new Error('Não foi possível iniciar a instalação segura. Atualize a página e tente novamente.'));close();};
  return {close,call(action,payload={},transfer=[]){return new Promise((resolve,reject)=>{if(closed)return reject(new Error('Inicie a instalação novamente.'));const id=++next,timer=setTimeout(()=>{reject(new Error('O arquivo demorou demais para abrir. Confira o A1 e tente novamente.'));close();},45000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,action,...payload},transfer);});}};
}
function installCertificateA1(context){
  assertOperationContext(context);
  return new Promise((resolve,reject)=>{
    const company=cache.empresas.find(x=>x.id===context.empresa),dialog=dialogShell(document,'Instalar certificado A1',company?.nome||'Empresa selecionada');
    dialog.classList.add('certificate-install-dialog');
    dialog.querySelector('.dialog-content').innerHTML='<form id="certificateFileForm"><p class="field-help">1. Escolha o A1 · 2. Confira o titular · 3. Instale no cofre</p><label for="certificateFile">Arquivo do certificado (.pfx ou .p12)</label><input id="certificateFile" type="file" accept=".pfx,.p12" required><label for="certificatePassword">Senha do arquivo A1</label><input id="certificatePassword" type="password" autocomplete="off" maxlength="1024"><p class="field-help">Esta é a senha fornecida com o certificado. O arquivo é aberto neste navegador; o arquivo original e a senha não são enviados ao servidor.</p><button class="btn btn-primary" type="submit">Conferir certificado</button></form><div id="certificateReview" class="hidden"><h3>Confira antes de instalar</h3><p id="certificateReviewSubject"></p><p id="certificateReviewValidity"></p><p>A chave será protegida no cofre desta empresa para certificar suas fichas. Somente o Master poderá substituir ou desativar o cadastro.</p><button id="certificateInstallConfirm" class="btn btn-primary" type="button">Instalar no cofre</button></div>';
    const form=dialog.querySelector('form'),fileInput=dialog.querySelector('#certificateFile'),password=dialog.querySelector('#certificatePassword'),confirmButton=dialog.querySelector('#certificateInstallConfirm');
    let cryptoWorker=null,chain=null,importId='',busy=false,done=false,finished=false,submitted=false;
    const stop=()=>{cryptoWorker?.close();cryptoWorker=null;password.value='';fileInput.value='';chain=null;};
    const post=async(path,body)=>{assertOperationContext(context);const controller=new AbortController();operationControllers.add(controller);const timeout=setTimeout(()=>controller.abort(),60000);try{const r=ensureSuccess(await api('/api/jpged/cofre/'+path,{method:'POST',body:JSON.stringify(body),signal:controller.signal}));assertOperationContext(context);if(!dialog.isConnected||finished)throw new Error('Instalação encerrada. Atualize a situação do certificado.');return r.body;}finally{clearTimeout(timeout);operationControllers.delete(controller);}};
    const cancelImport=async()=>{if(!importId)return;try{assertOperationContext(context);await api('/api/jpged/cofre/'+encodeURIComponent(importId)+'/cancelar',{method:'POST',body:'{}'});}catch{}importId='';};
    const waitForStage=async(expected,resubmit)=>{
      const deadline=Date.now()+240000;let retried=false;
      while(Date.now()<deadline){
        assertOperationContext(context);if(finished)throw new Error('Instalação encerrada. Atualize a situação do certificado.');
        try{
          const controller=new AbortController();operationControllers.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
          let state;try{state=ensureSuccess(await api('/api/jpged/cofre/'+encodeURIComponent(importId)+'/situacao',{signal:controller.signal})).body;}finally{clearTimeout(timer);operationControllers.delete(controller);}
          assertOperationContext(context);
          if(state.phase==='installed')return {installed:true};
          if(state.phase===expected)return state;
          if(!retried&&Date.now()>deadline-230000&&state.phase===(expected==='proved'?'prepared':'proved')){retried=true;await resubmit();}
          if(state.phase==='failed')throw Object.assign(new Error(state.failure?.message||'A instalação não foi concluída.'),{code:state.failure?.code,terminal:true});
          if(['cancelled','expired'].includes(state.phase))throw Object.assign(new Error('A tentativa foi encerrada. Inicie a instalação novamente.'),{terminal:true});
        }catch(error){if(error.terminal||error.code==='SESSION_CHANGED'||[401,403,409].includes(error.status))throw error;}
        dialogMessage(dialog,expected==='proved'?'Validando o certificado. A consulta pode levar alguns minutos; aguarde...':'Concluindo a instalação. Aguarde a confirmação do cofre...');
        await new Promise(r=>setTimeout(r,1500));
      }
      throw new Error('A confirmação ainda não chegou. A tentativa foi preservada; atualize a situação do certificado antes de iniciar outra instalação.');
    };
    const runStage=async(path,body,expected)=>{
      submitted=true;
      try{const result=await post(path,body);if(!result.pending)return result;}
      catch(error){if(error.status&&error.status<500&&![408,409,429].includes(error.status))throw error;}
      return waitForStage(expected,()=>post(path,body));
    };
    const cleanup=()=>{if(finished)return;finished=true;stop();if(!submitted)void cancelImport();certificateCleanup=null;if(!done)reject(new Error('Instalação encerrada. O certificado anterior permanece até a conclusão de uma nova instalação.'));};
    certificateCleanup=()=>{cleanup();if(dialog.open)dialog.close();};
    dialog.addEventListener('close',cleanup,{once:true});
    dialog.addEventListener('cancel',event=>{if(busy){event.preventDefault();dialogMessage(dialog,'Aguarde esta etapa terminar.','');}});
    const setBusy=value=>{busy=value;form.querySelector('button').disabled=value;confirmButton.disabled=value;dialog.querySelector('.dialog-close').disabled=value;};
    form.onsubmit=async event=>{event.preventDefault();if(busy)return;setBusy(true);dialogMessage(dialog,'Abrindo o arquivo com segurança neste navegador...');
      try{
        assertOperationContext(context);const file=fileInput.files?.[0];if(!file||! /\.(pfx|p12)$/i.test(file.name)||file.size>1024*1024)throw new Error('Escolha o arquivo original .pfx ou .p12 de até 1 MB.');
        cryptoWorker?.close();cryptoWorker=certificateWorker();const fileBytes=await file.arrayBuffer(),secret=password.value;password.value='';
        const info=await cryptoWorker.call('open',{file:fileBytes,password:secret,company:context.empresa},[fileBytes]);assertOperationContext(context);if(finished)return;
        chain=info.chain;fileInput.value='';form.classList.add('hidden');dialog.querySelector('#certificateReview').classList.remove('hidden');dialog.querySelector('#certificateReviewSubject').textContent=info.subject;dialog.querySelector('#certificateReviewValidity').textContent='Válido até '+new Date(info.validTo).toLocaleDateString('pt-BR');dialogMessage(dialog,'Arquivo aberto. Confira o titular e a empresa acima.');confirmButton.focus();
      }catch(error){stop();if(!finished)dialogMessage(dialog,error.message,'error');}finally{if(!finished)setBusy(false);}
    };
    confirmButton.onclick=async()=>{if(busy||!chain)return;setBusy(true);
      try{
        dialogMessage(dialog,'1 de 3 · Validando o certificado e sua autorização...');
        const prepared=await post('preparar',{chain});importId=prepared.configuration.id;
        const proof=await cryptoWorker.call('prove',{configuration:prepared.configuration});
        const wrapping=await runStage(encodeURIComponent(importId)+'/comprovar',proof,'proved');
        dialogMessage(dialog,'2 de 3 · Protegendo a chave para o cofre...');
        const wrapped=await cryptoWorker.call('wrap',{wrappingKey:wrapping.wrappingKey});stop();
        dialogMessage(dialog,'3 de 3 · Testando a assinatura e ativando o certificado...');
        await runStage(encodeURIComponent(importId)+'/concluir',wrapped,'installed');
        done=true;importId='';dialog.close();resolve();
      }catch(error){stop();if(!submitted)await cancelImport();if(!finished){const help=error.code==='CERTIFICADO_CADEIA_INVALIDA'?' Exporte o A1 com a cadeia completa de certificados e confira sua validade.':error.name==='AbortError'?' A resposta demorou. A operação pode ter terminado no servidor.':'';dialogMessage(dialog,error.message+help+' Feche esta janela e atualize a situação antes de tentar novamente.','error');confirmButton.classList.add('hidden');}}
      finally{if(!finished)setBusy(false);}
    };
    fileInput.focus();
  });
}
