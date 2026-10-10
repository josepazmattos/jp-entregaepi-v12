(function(root){
  'use strict';
  const PORTS=Object.freeze(Array.from({length:11},(_,index)=>8789+index));
  const FINGERS=Object.freeze([
    ['R_THUMB','Polegar direito','RIGHT_THUMB'],['R_INDEX','Indicador direito','RIGHT_INDEX'],
    ['R_MIDDLE','Médio direito','RIGHT_MIDDLE'],['R_RING','Anelar direito','RIGHT_RING'],['R_LITTLE','Mínimo direito','RIGHT_LITTLE'],
    ['L_THUMB','Polegar esquerdo','LEFT_THUMB'],['L_INDEX','Indicador esquerdo','LEFT_INDEX'],
    ['L_MIDDLE','Médio esquerdo','LEFT_MIDDLE'],['L_RING','Anelar esquerdo','LEFT_RING'],['L_LITTLE','Mínimo esquerdo','LEFT_LITTLE']
  ].map(Object.freeze));
  const MAX_IMAGE_BYTES=150*1024;
  const RUNTIME_DIAGNOSTICS=Object.freeze({
    JAVA_NOT_FOUND:Object.freeze({title:'Java não localizado',message:'O Java necessário não foi localizado. Em Biometria, use Baixar instalador completo e execute o arquivo. O pacote prepara o Java automaticamente, sem configurações manuais.'}),
    JAVA_ARCH_MISMATCH:Object.freeze({title:'Java e SDK com arquiteturas diferentes',message:'O Java e o SDK instalados não combinam. Em Biometria, execute o instalador completo para preparar os componentes compatíveis automaticamente.'}),
    SDK_NOT_FOUND:Object.freeze({title:'SDK NITGEN não localizado',message:'O SDK eNBioBSP com o componente Java não foi localizado. Em Biometria, use Baixar instalador completo e execute o arquivo. Não é necessário informar serial nem localizar arquivos.'}),
    SDK_DLL_NOT_FOUND:Object.freeze({title:'Bibliotecas do SDK NITGEN ausentes',message:'Faltam componentes do SDK NITGEN. Em Biometria, execute o instalador completo para preparar os arquivos necessários automaticamente.'}),
    SDK_ARCH_MISMATCH:Object.freeze({title:'Bibliotecas NITGEN incompatíveis entre si',message:'Os componentes NITGEN instalados não combinam. Em Biometria, execute o instalador completo para preparar a versão compatível com o Hamster DX.'})
  });
  const MESSAGES={
    BIO_BUSY:'Já existe uma operação com o leitor em andamento. Aguarde sua conclusão.',
    BIO_CANCELLED:'A operação com o leitor foi cancelada.',
    BIO_TIMEOUT:'O agente local não respondeu no prazo. A captura não foi repetida automaticamente. Confira o agente e tente novamente.',
    BIO_NETWORK:'O navegador não conseguiu acessar o JP Biometria neste computador. Confira se o agente está aberto e se o site tem permissão para acessar a rede local.',
    BIO_PERMISSION:'O navegador bloqueou o acesso ao leitor local. Nas permissões deste site, permita o acesso à rede local e verifique novamente.',
    BIO_PERMISSION_REQUIRED:'Clique em Permitir e verificar leitor e autorize o acesso local, se o navegador solicitar. Com a permissão concedida, a verificação será automática nos próximos acessos.',
    BIO_PROTOCOL:'Um serviço respondeu, mas não confirmou o protocolo do JP Biometria. Confira se o agente correto está aberto.',
    BIO_NOT_READY:'O agente respondeu, mas não confirmou um leitor pronto. Feche o diagnóstico NITGEN se ele estiver usando o leitor e verifique novamente.',
    BIO_AGENT_UPDATE:'O componente local precisa ser atualizado. Em Biometria, use Baixar instalador completo e execute o arquivo. Ao voltar ao site, o indicador será atualizado automaticamente.',
    BIO_CHECKING:'O agente ainda está verificando o leitor. Aguarde alguns segundos e clique em Verificar leitor novamente.',
    BIO_RUNTIME:'O componente local está atualizado, mas a configuração de Java ou SDK impede a captura.',
    BIO_HTTP:'O agente local respondeu com erro. Confira o agente neste computador antes de repetir a operação.',
    BIO_CAPTURE_FAILED:'O agente não concluiu a captura. Confira o leitor, feche outros programas de diagnóstico e tente novamente.',
    BIO_IMAGE_MISSING:'O agente não retornou uma imagem real da captura. Nenhuma assinatura foi registrada.',
    BIO_IMAGE_INVALID:'A imagem retornada pelo leitor não pôde ser validada. Nenhuma assinatura foi registrada.',
    BIO_IMAGE_LARGE:'A imagem da captura ultrapassa 150 KB. Ajuste a exportação no agente local e capture novamente.',
    BIO_RESPONSE_LARGE:'A resposta do agente ultrapassa o tamanho permitido. Confira a configuração do agente.',
    BIO_FINGER:'Selecione o dedo utilizado na captura.'
  };
  function failure(code,details={}){return Object.assign(new Error(MESSAGES[code]||MESSAGES.BIO_CAPTURE_FAILED),{code,...details});}
  function safeCode(value){return typeof value==='string'&&/^[A-Z0-9_:-]{1,60}$/.test(value)?value:undefined;}
  function versionAtLeast(value,minimum){const left=value.split(/[.+-]/).slice(0,3).map(Number),right=minimum.split('.').map(Number);for(let i=0;i<3;i++){if((left[i]||0)>right[i])return true;if((left[i]||0)<right[i])return false;}return true;}
  function unavailableError(status){
    if(status?.upgradeRequired)return failure('BIO_AGENT_UPDATE');
    if(status?.runtimeCode&&Object.prototype.hasOwnProperty.call(RUNTIME_DIAGNOSTICS,status.runtimeCode))return failure('BIO_RUNTIME',{message:RUNTIME_DIAGNOSTICS[status.runtimeCode].message});
    return failure(status?.checking?'BIO_CHECKING':'BIO_NOT_READY');
  }
  function normalizeStatus(body,port){
    if(!body||typeof body!=='object'||Array.isArray(body))throw failure('BIO_PROTOCOL');
    const service=String(body.service||body.agent||body.app||body.name||'');
    const version=String(body.version||body.versao||'');
    const validVersion=/^\d{1,3}(?:\.\d{1,3}){1,3}(?:[-+][A-Za-z0-9.-]{1,40})?$/.test(version);
    const jp=/\bjp[\s_-]*biometria\b/i.test(service);
    const device=String(body.deviceName||'');
    const nitgen=/\b(?:nitgen|hamster|hfdu0[16]|fdu0[16])\b/i.test([device,typeof body.reader==='string'?body.reader:'',body.sdkName||''].join(' '));
    const hasReaderField=typeof body.reader==='boolean'||typeof body.readerConnected==='boolean'||Number.isInteger(body.deviceCount);
    if(!(jp||(validVersion&&nitgen&&hasReaderField)))throw failure('BIO_PROTOCOL');
    const sdkMissing=body.sdk===false||body.sdkLoaded===false||body.sdkReady===false;
    const denied=body.reader===false||body.readerConnected===false||body.deviceCount===0||sdkMissing;
    const detected=!denied&&(body.reader===true||body.readerConnected===true||(Number.isInteger(body.deviceCount)&&body.deviceCount>0));
    const compatible=validVersion&&versionAtLeast(version,'12.8.1')&&typeof body.capabilities?.capture==='boolean'&&body.capabilities?.captureMethod==='POST'&&body.capabilities?.capturePath==='/api/capture';
    const captureAvailable=compatible&&body.capabilities.capture===true;
    const runtimeCode=compatible&&typeof body.errorCode==='string'&&Object.prototype.hasOwnProperty.call(RUNTIME_DIAGNOSTICS,body.errorCode)?body.errorCode:'';
    const runtimeIssue=runtimeCode?RUNTIME_DIAGNOSTICS[runtimeCode]:null;
    const busy=body.busy===true,checking=body.checking===true;
    const ready=body.ok===true&&captureAvailable&&detected&&!busy&&!checking&&!runtimeIssue;
    return Object.freeze({port,service:'JP Biometria',version:validVersion?version:'Não informada',recognized:true,
      ready,compatible,captureAvailable,enrollmentImageAvailable:compatible&&versionAtLeast(version,'12.9.1')&&body.capabilities?.templates===true,verificationAvailable:compatible&&body.capabilities?.verify===true&&body.capabilities?.templates===true,upgradeRequired:!compatible,busy,checking,readerDetected:detected,sdkMissing,
      runtimeCode,runtimeTitle:runtimeIssue?.title||'',runtimeMessage:runtimeIssue?.message||'',
      deviceName:nitgen&&device.length<=80&&/^[\w .()\/-]+$/.test(device)?device:'Leitor NITGEN',
      code:ready?'LEITOR_DETECTADO':!compatible?'AGENTE_REQUER_ATUALIZACAO':runtimeCode|| (busy?'LEITOR_OCUPADO':checking?'VERIFICANDO_LEITOR':sdkMissing?'SDK_INDISPONIVEL':!captureAvailable?'CAPTURA_INDISPONIVEL':body.ok!==true?'AGENTE_REQUER_ATENCAO':'LEITOR_NAO_DETECTADO')});
  }
  async function readJson(response,maxBytes,signal){
    let text='';
    if(response.body&&typeof response.body.getReader==='function'&&typeof TextDecoder==='function'){
      const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;
      try{while(true){if(signal?.aborted)throw failure('BIO_CANCELLED');const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes)throw failure('BIO_RESPONSE_LARGE');text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}
      catch(error){await reader.cancel().catch(()=>{});throw error;}
      finally{reader.releaseLock();}
    }else{text=await response.text();if(text.length>maxBytes)throw failure('BIO_RESPONSE_LARGE');}
    try{return JSON.parse(text);}catch(error){throw failure('BIO_PROTOCOL');}
  }
  function createClient(options={}){
    const fetcher=options.fetch||((...args)=>root.fetch(...args));
    const queryPermission=options.queryPermission||(()=>root.navigator?.permissions?.query({name:'loopback-network'}));
    const statusTimeout=options.statusTimeout||800,primaryStatusTimeout=options.primaryStatusTimeout||8000,captureTimeout=options.captureTimeout||35000;
    const checkingTimeout=options.checkingTimeout||8000,discoveryTimeout=options.discoveryTimeout||20000,pollInterval=options.pollInterval||250;
    let selected=null,operation=null,lastDiagnostics=[];
    async function locked(callback,externalSignal,automatic=false){
      if(operation)throw failure('BIO_BUSY');
      const controller=new AbortController();operation=controller;
      const abort=()=>controller.abort();externalSignal?.addEventListener('abort',abort,{once:true});if(externalSignal?.aborted)controller.abort();
      try{
        if(controller.signal.aborted)throw failure('BIO_CANCELLED');
        let permission;
        try{permission=await queryPermission();}catch(error){/* Older browsers do not expose this permission name. */}
        if(controller.signal.aborted)throw failure('BIO_CANCELLED');
        if(permission?.state==='denied')throw failure('BIO_PERMISSION');
        if(automatic&&permission?.state!=='granted')throw failure('BIO_PERMISSION_REQUIRED');
        return await callback(controller.signal);
      }
      finally{externalSignal?.removeEventListener('abort',abort);if(operation===controller)operation=null;}
    }
    async function request(port,path,signal,timeout,maxBytes,requestOptions={}){
      if(!PORTS.includes(port)||!path.startsWith('/'))throw failure('BIO_PROTOCOL');
      const controller=new AbortController();let timedOut=false;
      const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
      try{
        const response=await fetcher(`http://127.0.0.1:${port}${path}`,{method:'GET',...requestOptions,mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',signal:controller.signal});
        if(signal.aborted)throw failure('BIO_CANCELLED');
        if(!response.ok){
          const body=await readJson(response,16000,controller.signal).catch(()=>null);
          const agentCode=safeCode(body?.errorCode||body?.code);
          const error=failure('BIO_HTTP',{httpStatus:response.status,agentCode});
          if(agentCode==='BIOMETRIA_DIVERGENTE')error.message='A digital não corresponde ao cadastro. A ficha continua sem assinatura.';
          if(agentCode==='BIOMETRIC_DEVICE_DIFFERENT')error.message='Esta digital foi cadastrada em outro computador. Cadastre-a neste computador antes de assinar.';
          const known={READER_BUSY:'O leitor está em uso. Aguarde a operação atual e tente novamente.',SDK_API_INCOMPATIBLE:'O SDK instalado não oferece a interface esperada pelo JP Biometria. Confira a instalação do componente Java NITGEN.',SDK_LOAD_FAILED:'Não foi possível carregar o SDK NITGEN. Confira Java e bibliotecas da mesma arquitetura.',READER_NOT_FOUND:'O SDK não localizou o leitor NITGEN. Confira a conexão USB.',CAPTURE_FAILED:'O SDK não concluiu a captura. Feche outros programas que estejam usando o leitor e tente novamente.'};
          if(Object.prototype.hasOwnProperty.call(known,agentCode))error.message=known[agentCode];
          if(/^NITGEN_[0-9]{1,10}$/.test(agentCode||''))error.message='O leitor NITGEN não concluiu a operação. Código: '+agentCode+'. Confira a posição do dedo e feche outros programas de captura antes de tentar novamente.';
          throw error;
        }
        const body=await readJson(response,maxBytes,controller.signal);
        if(signal.aborted)throw failure('BIO_CANCELLED');
        return body;
      }catch(error){
        if(signal.aborted)throw failure('BIO_CANCELLED');
        if(timedOut)throw failure('BIO_TIMEOUT');
        if(error.code&&MESSAGES[error.code])throw error;
        if(error.name==='NotAllowedError'||error.name==='SecurityError')throw failure('BIO_PERMISSION');
        throw failure('BIO_NETWORK');
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    }
    async function discover({signal,automatic=false,requireEnrollmentImage=false}={}){
      return locked(async operationSignal=>{
        const ports=selected?[selected.port,...PORTS.filter(port=>port!==selected.port)]:PORTS;
        const diagnostics=[],deadline=Date.now()+discoveryTimeout;let recognized=null,winner=null,fatal=null;selected=null;
        const search=new AbortController(),abort=()=>search.abort();operationSignal.addEventListener('abort',abort,{once:true});
        if(operationSignal.aborted)search.abort();
        function pause(ms){return new Promise(resolve=>{if(search.signal.aborted)return resolve();const done=()=>{clearTimeout(timer);search.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);search.signal.addEventListener('abort',done,{once:true});});}
        async function probe(port){
          if(search.signal.aborted||Date.now()>=deadline)return null;
          try{
            const fetchStatus=()=>request(port,'/status?ts='+Date.now(),search.signal,Math.max(1,Math.min(port===8789?primaryStatusTimeout:statusTimeout,deadline-Date.now())),16384);
            let status=normalizeStatus(await fetchStatus(),port);
            const checkingDeadline=Math.min(deadline,Date.now()+checkingTimeout);
            while(status.compatible&&status.checking&&!status.busy&&!search.signal.aborted&&Date.now()+pollInterval<checkingDeadline){await pause(pollInterval);if(search.signal.aborted)return null;status=normalizeStatus(await fetchStatus(),port);}
            if(search.signal.aborted)return null;
            diagnostics.push({port,code:status.code});
            if(status.ready&&(!requireEnrollmentImage||status.enrollmentImageAvailable)){winner=status;search.abort();return status;}
            if(!recognized||(!recognized.compatible&&status.compatible)||(requireEnrollmentImage&&!recognized.enrollmentImageAvailable&&status.enrollmentImageAvailable))recognized=status;
          }catch(error){
            if(search.signal.aborted)return null;
            diagnostics.push({port,code:error.code,httpStatus:error.httpStatus});
            if(error.code==='BIO_PERMISSION'){fatal=error;search.abort();}
          }
          return null;
        }
        try{
          // Prefer the known port. If it stalls, look elsewhere without waiting
          // its full timeout. Only GET /status is raced, never a capture or write.
          const primary=probe(ports[0]);
          const fallback=(async()=>{await Promise.race([primary,pause(options.discoveryHedgeMs??200)]);for(const port of ports.slice(1)){if(search.signal.aborted)break;await probe(port);}})();
          await Promise.all([primary,fallback]);
          if(operationSignal.aborted)throw failure('BIO_CANCELLED');
          lastDiagnostics=diagnostics;
          if(fatal)throw fatal;
          if(winner){selected=winner;return winner;}
          if(recognized){selected=recognized;return recognized;}
          if(diagnostics.some(item=>item.code==='BIO_PROTOCOL'))throw failure('BIO_PROTOCOL');
          if(diagnostics.some(item=>item.code==='BIO_HTTP'))throw failure('BIO_HTTP');
          throw failure('BIO_NETWORK');
        }finally{search.abort();operationSignal.removeEventListener('abort',abort);}
      },signal,automatic);
    }
    async function capture({fingerCode,purpose='test',signal}={}){
      const finger=FINGERS.find(item=>item[0]===fingerCode);if(!finger)throw failure('BIO_FINGER');
      if(!selected?.ready)throw unavailableError(selected);
      return locked(async operationSignal=>{
        const port=selected.port;
        const requestOptions={method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({cmd:'capture',purpose:purpose==='signature'?'signature':'test',fingerCode,agentFingerCode:finger[2],requireRealImage:true,requireTemplate:false})};
        let response;
        try{response=await request(port,'/api/capture',operationSignal,captureTimeout,2*1024*1024,requestOptions);}
        catch(error){if(error.code!=='BIO_HTTP'||![404,405].includes(error.httpStatus))throw error;response=await request(port,'/capture',operationSignal,captureTimeout,2*1024*1024,requestOptions);}
        if(!response||typeof response!=='object'||Array.isArray(response)||response.ok!==true)throw failure('BIO_CAPTURE_FAILED',{agentCode:safeCode(response?.code)});
        if(operationSignal.aborted)throw failure('BIO_CANCELLED');
        // Older agents return a template even when requireTemplate=false. Keep
        // only image fields; the template must not enter UI state or diagnostics.
        return {ok:true,realFingerImage:response.realFingerImage,
          fingerImageDataUrl:response.fingerImageDataUrl,imageDataUrl:response.imageDataUrl,
          imageBase64:response.imageBase64,image:response.image};
      },signal);
    }
    async function biometric(challenge,{signal}={}){
      if(!selected?.ready)throw unavailableError(selected);
      if(!selected.verificationAvailable)throw new Error('Atualize o JP Biometria para cadastrar e comparar digitais.');
      return locked(async operationSignal=>{
        const body=await request(selected.port,challenge.kind==='enroll'?'/api/enroll':'/api/signature',operationSignal,captureTimeout,2*1024*1024,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(challenge)});
        if(!body?.ok||!body.proof||!body.proofSignature)throw failure('BIO_PROTOCOL');
        return body;
      },signal);
    }
    return Object.freeze({discover,capture,biometric,cancel(){operation?.abort();},clear(){operation?.abort();selected=null;lastDiagnostics=[];},getStatus:()=>selected,getDiagnostics:()=>lastDiagnostics.map(item=>({...item}))});
  }
  function extractImage(body){
    if(!body||body.realFingerImage!==true)throw failure('BIO_IMAGE_MISSING');
    const value=[body.fingerImageDataUrl,body.imageDataUrl,body.imageBase64,body.image].find(item=>typeof item==='string'&&item.trim());
    if(!value)throw failure('BIO_IMAGE_MISSING');
    const raw=value.trim();let mime='',base64=raw;
    if(raw.startsWith('data:')){const match=/^data:image\/(png|jpeg|bmp|x-ms-bmp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);if(!match)throw failure('BIO_IMAGE_INVALID');mime=match[1];base64=match[2];}
    if(base64.length>2800000||base64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw failure('BIO_IMAGE_INVALID');
    let bytes;try{bytes=Uint8Array.from(root.atob(base64),character=>character.charCodeAt(0));}catch(error){throw failure('BIO_IMAGE_INVALID');}
    const png=bytes.length>32&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
    const jpeg=bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217;
    const bmp=bytes.length>=54&&bytes[0]===66&&bytes[1]===77;
    const detected=png?'png':jpeg?'jpeg':bmp?'bmp':'';
    if(!detected||(mime&&(mime==='x-ms-bmp'?'bmp':mime)!==detected))throw failure('BIO_IMAGE_INVALID');
    if(detected!=='bmp'&&bytes.length>MAX_IMAGE_BYTES)throw failure('BIO_IMAGE_LARGE');
    // Refuse oversized dimensions before asking the browser to allocate pixels.
    const uint16=offset=>(bytes[offset]<<8)|bytes[offset+1];
    const uint32=offset=>bytes[offset]*16777216+(bytes[offset+1]<<16)+(bytes[offset+2]<<8)+bytes[offset+3];
    let width=0,height=0;
    if(detected==='png'){
      if(![73,72,68,82].every((value,index)=>bytes[12+index]===value))throw failure('BIO_IMAGE_INVALID');
      width=uint32(16);height=uint32(20);
    }else if(detected==='bmp'){
      const little32=offset=>(bytes[offset]|(bytes[offset+1]<<8)|(bytes[offset+2]<<16)|(bytes[offset+3]<<24));
      width=little32(18);height=Math.abs(little32(22));
    }else{
      let cursor=2;
      while(cursor+4<bytes.length){
        if(bytes[cursor++]!==255)throw failure('BIO_IMAGE_INVALID');while(bytes[cursor]===255)cursor++;
        const marker=bytes[cursor++];if(marker===217||marker===218)break;
        if(marker===1||(marker>=208&&marker<=215))continue;
        const size=uint16(cursor);if(size<2||cursor+size>bytes.length)throw failure('BIO_IMAGE_INVALID');
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
          if(size<8)throw failure('BIO_IMAGE_INVALID');height=uint16(cursor+3);width=uint16(cursor+5);break;
        }
        cursor+=size;
      }
    }
    if(!width||!height||width>2048||height>2048||width<0)throw failure('BIO_IMAGE_INVALID');
    return {src:`data:image/${detected};base64,${base64}`,mime:detected,byteLength:bytes.length};
  }
  async function prepareCaptureImage(body,{signal}={}){
    const candidate=extractImage(body);if(signal?.aborted)throw failure('BIO_CANCELLED');
    const image=new root.Image();let timer;
    const abort=()=>{image.src='';};signal?.addEventListener('abort',abort,{once:true});
    try{
      image.src=candidate.src;
      await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('BIO_IMAGE_INVALID')),10000);})]);
      if(signal?.aborted)throw failure('BIO_CANCELLED');
      if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>2048||image.naturalHeight>2048)throw failure('BIO_IMAGE_INVALID');
      if(candidate.mime!=='bmp')return candidate.src;
      const canvas=root.document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');if(!context)throw failure('BIO_IMAGE_INVALID');context.drawImage(image,0,0);
      for(const format of [['image/png'],['image/jpeg',0.9],['image/jpeg',0.8],['image/jpeg',0.7]]){
        const converted=canvas.toDataURL(...format);
        try{return extractImage({realFingerImage:true,imageDataUrl:converted}).src;}catch(error){if(error.code!=='BIO_IMAGE_LARGE')throw error;}
      }
      throw failure('BIO_IMAGE_LARGE');
    }catch(error){if(signal?.aborted)throw failure('BIO_CANCELLED');if(error.code&&MESSAGES[error.code])throw error;throw failure('BIO_IMAGE_INVALID');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);image.src='';}
  }
  const exported=Object.freeze({PORTS,FINGERS,MAX_IMAGE_BYTES,createClient,normalizeStatus,extractImage,prepareCaptureImage,failure,unavailableError});
  root.JP_BIOMETRIA=exported;
  if(typeof module==='object'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
