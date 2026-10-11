// Refresh only application code, preserving the session and unfinished work.
(()=>{
  const current=document.querySelector('meta[name="jp-build"]')?.content;
  if(!/^[a-f0-9]{40}$/.test(current||''))return;
  let pending='',checking=false,reloading=false,lastCheck=0;
  const fields=new Map(),value=node=>/^(checkbox|radio)$/.test(node.type)?node.checked:node.value;
  document.addEventListener('focusin',event=>{const n=event.target;if(n.matches?.('input,textarea,select')&&!fields.has(n))fields.set(n,value(n));});
  document.addEventListener('input',event=>{const n=event.target;if(n.matches?.('input,textarea,select')&&!fields.has(n))fields.set(n,/^(checkbox|radio)$/.test(n.type)?n.defaultChecked:n.defaultValue);});
  document.addEventListener('reset',event=>{for(const n of fields.keys())if(event.target.contains(n))fields.delete(n);});
  document.getElementById('logoutButton')?.addEventListener('click',()=>fields.clear());
  function safe(){
    if(document.visibilityState!=='visible'||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))return false;
    const logged=!document.getElementById('appShell')?.classList.contains('hidden');
    if(logged&&!document.getElementById('screen-dashboard')?.classList.contains('active'))return false;
    for(const [n,initial] of fields){if(!n.isConnected){fields.delete(n);continue;}if(Boolean(n.closest('#appShell'))===logged&&value(n)!==initial)return false;}
    if(typeof biometricBusy!=='undefined'&&biometricBusy||typeof entregaSaving!=='undefined'&&entregaSaving||typeof companySaving!=='undefined'&&companySaving||typeof startupChecksPromise!=='undefined'&&startupChecksPromise)return false;
    if(typeof entregaItems!=='undefined'&&entregaItems.length||typeof importPreview!=='undefined'&&importPreview||typeof companyPdfLoading!=='undefined'&&companyPdfLoading)return false;
    if(typeof operationControllers!=='undefined'&&operationControllers.size)return false;
    if(typeof operationWindows!=='undefined'&&[...operationWindows].some(w=>!w.closed))return false;
    return true;
  }
  function apply(){
    if(!pending||reloading||!safe())return false;
    reloading=true;
    const url=new URL(location.href);url.searchParams.set('v',pending);
    location.replace(url.href);return true;
  }
  async function check(){
    if(checking||reloading||document.visibilityState!=='visible')return;
    if(pending){apply();return;}
    checking=true;lastCheck=Date.now();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const url=new URL((window.JP_CONFIG?.appBasePath||'/EntregaEPI/')+'index.html',location.origin);
      url.searchParams.set('update-check',String(Date.now()));
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      if(!response.ok)return;
      const source=await response.text();if(source.length>250000)return;
      const latest=new DOMParser().parseFromString(source,'text/html').querySelector('meta[name="jp-build"]')?.content;
      if(/^[a-f0-9]{40}$/.test(latest||'')&&latest!==current){pending=latest;apply();}
    }catch{/* Offline or unavailable release check does not affect work. */}
    finally{clearTimeout(timer);checking=false;}
  }
  const onReturn=()=>{if(pending)apply();else if(Date.now()-lastCheck>30000)check();};
  window.addEventListener('focus',onReturn);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')onReturn();});
  setTimeout(check,15000);setInterval(check,300000);setInterval(apply,15000);
  window.JPAutoUpdate=Object.freeze({check});
})();
