// Contrato do leitor com respostas sintéticas. Nenhum hardware ou serviço real.
const test=require('node:test');
const assert=require('node:assert/strict');
const bio=require('../frontend/EntregaEPI/assets/biometria.js');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const ready={ok:true,service:'JP Biometria Local Java',version:'12.9.3',capabilities:{capture:true,captureMethod:'POST',capturePath:'/api/capture'},sdk:true,reader:true,deviceCount:1,deviceName:'NITGEN HFDU06'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const refused=()=>Promise.reject(new TypeError('Failed to fetch'));
function client(route,options={}){
  const requests=[];
  const instance=bio.createClient({fetch:async(url,init)=>{requests.push({url,init});return route(new URL(url),init);},primaryStatusTimeout:30,statusTimeout:10,captureTimeout:30,...options});
  return {instance,requests};
}
function pendingUntilAbort(_url,{signal}){return new Promise((resolve,reject)=>{const fail=()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}));if(signal.aborted)fail();else signal.addEventListener('abort',fail,{once:true});});}

test('biometria: contrato exige JSON de agente conhecido e detecção explícita',()=>{
  assert.equal(bio.normalizeStatus(ready,8789).ready,true);
  assert.equal(bio.normalizeStatus({...ready,reader:false},8789).ready,false);
  assert.equal(bio.normalizeStatus({...ready,deviceCount:0},8789).ready,false);
  assert.equal(bio.normalizeStatus({...ready,sdk:false},8789).ready,false);
  assert.equal(bio.normalizeStatus({...ready,ok:false},8789).ready,false);
  assert.equal(bio.normalizeStatus({...ready,reader:undefined,deviceCount:undefined},8789).ready,false);
  assert.equal(bio.normalizeStatus({...ready,version:'inválida'},8789).ready,false);
  for(const invalid of ['<html>outro serviço</html>',null,[],{ok:true,service:'OUTRO SERVIÇO'},{ok:false}])assert.throws(()=>bio.normalizeStatus(invalid,8789),error=>error.code==='BIO_PROTOCOL');
});

test('biometria: procura somente portas loopback conhecidas, sem credenciais ou dados pessoais',async()=>{
  const {instance,requests}=client(url=>url.port==='8790'?json(ready):refused());
  assert.equal((await instance.discover()).port,8790);
  assert.equal(requests.length,2);
  for(const request of requests){const url=new URL(request.url);assert.equal(url.hostname,'127.0.0.1');assert.ok(bio.PORTS.includes(Number(url.port)));assert.equal(url.pathname,'/status');assert.deepEqual([...url.searchParams.keys()],['ts']);assert.equal(request.init.credentials,'omit');assert.equal(request.init.mode,'cors');assert.equal(request.init.redirect,'error');assert.equal(request.init.targetAddressSpace,'loopback');assert.equal(request.init.headers,undefined);assert.equal(request.init.body,undefined);}
});

test('biometria: HTTP 200 incompatível não vira leitor pronto nem expõe seu conteúdo',async()=>{
  const secret='TEMPLATE-SINTETICO-NAO-MOSTRAR';
  const {instance}=client(()=>json({ok:true,image:pixel,template:secret,service:'OUTRO SERVIÇO'}));
  await assert.rejects(instance.discover(),error=>error.code==='BIO_PROTOCOL');
  const diagnostics=JSON.stringify(instance.getDiagnostics());assert.ok(!diagnostics.includes(secret));assert.ok(!diagnostics.includes('data:image'));assert.equal(instance.getStatus(),null);
});

test('biometria: agente sem leitor permanece como atenção',async()=>{
  const {instance}=client(url=>url.port==='8789'?json({...ready,reader:false,deviceCount:0}):refused());
  const state=await instance.discover();assert.equal(state.ready,false);assert.equal(state.code,'LEITOR_NAO_DETECTADO');
  await assert.rejects(instance.capture({fingerCode:'R_INDEX'}),error=>error.code==='BIO_NOT_READY');
});

test('biometria: permissão explicitamente negada interrompe antes de qualquer acesso',async()=>{
  const {instance,requests}=client(()=>json(ready),{queryPermission:async()=>({state:'denied'})});
  await assert.rejects(instance.discover(),error=>error.code==='BIO_PERMISSION');assert.equal(requests.length,0);
});

test('biometria: navegador sem nome de permissão mantém CORS sem contornar a proteção',async()=>{
  const {instance,requests}=client(()=>json(ready),{queryPermission:async()=>{throw new TypeError('Unsupported permission');}});
  assert.equal((await instance.discover()).ready,true);assert.equal(requests[0].init.mode,'cors');
});

test('biometria: descoberta tem prazo por porta e termina sem manter operação ocupada',async()=>{
  const {instance,requests}=client(pendingUntilAbort,{primaryStatusTimeout:10,statusTimeout:5});
  const start=Date.now();await assert.rejects(instance.discover(),error=>error.code==='BIO_NETWORK');
  assert.equal(requests.length,11);assert.ok(Date.now()-start<2000);assert.ok(instance.getDiagnostics().every(item=>item.code==='BIO_TIMEOUT'));
});

test('biometria: captura transmite somente comando necessário e descarta template/score do legado',async()=>{
  const {instance,requests}=client(url=>url.pathname==='/status'?json(ready):json({ok:true,realFingerImage:true,fingerImageDataUrl:pixel,template:'TEMPLATE-NAO-EXIBIR',matched:true,matchScore:'Conferido',log:'PRIVADO'}));
  await instance.discover();const response=await instance.capture({fingerCode:'L_INDEX',purpose:'signature',workerId:'NAO-ENVIAR',token:'NAO-ENVIAR'});
  assert.equal(response.fingerImageDataUrl,pixel);assert.equal(response.template,undefined);assert.equal(response.matched,undefined);assert.equal(response.matchScore,undefined);assert.equal(response.log,undefined);
  const request=requests.at(-1);assert.equal(request.init.method,'POST');assert.equal(request.init.headers['Content-Type'],'text/plain;charset=UTF-8');const body=JSON.parse(request.init.body);assert.equal(body.fingerCode,'L_INDEX');assert.equal(body.agentFingerCode,'LEFT_INDEX');assert.equal(body.requireTemplate,false);assert.equal(body.requireRealImage,true);assert.equal(body.purpose,'signature');assert.equal(body.workerId,undefined);assert.equal(body.token,undefined);
});

test('biometria: fallback de captura apenas em rota 404 ou 405',async()=>{
  for(const httpStatus of [404,405]){
    const {instance,requests}=client(url=>url.pathname==='/status'?json(ready):url.pathname==='/api/capture'?json({},httpStatus):json({ok:true,realFingerImage:true,fingerImageDataUrl:pixel}));
    await instance.discover();await instance.capture({fingerCode:'R_INDEX'});
    assert.deepEqual(requests.slice(1).map(request=>new URL(request.url).pathname),['/api/capture','/capture']);
  }
});

test('biometria: timeout, falha de rede e erro do SDK não repetem captura',async()=>{
  for(const failure of [()=>json({ok:false,message:'INFORMAÇÃO PRIVADA'}),()=>json({},500),()=>refused(),pendingUntilAbort]){
    const {instance,requests}=client((url,init)=>url.pathname==='/status'?json(ready):failure(url,init),{captureTimeout:10});
    await instance.discover();await assert.rejects(instance.capture({fingerCode:'R_INDEX'}),error=>/^BIO_/.test(error.code)&&!error.message.includes('PRIVADA'));
    assert.equal(requests.filter(request=>new URL(request.url).pathname.includes('capture')).length,1);
  }
});

test('biometria: cancelamento e exclusão mútua impedem operação sobreposta',async()=>{
  const {instance,requests}=client((url,init)=>url.pathname==='/status'?json(ready):pendingUntilAbort(url,init));
  await instance.discover();const pending=instance.capture({fingerCode:'R_INDEX'});await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(instance.capture({fingerCode:'R_INDEX'}),error=>error.code==='BIO_BUSY');await assert.rejects(instance.discover(),error=>error.code==='BIO_BUSY');
  instance.cancel();await assert.rejects(pending,error=>error.code==='BIO_CANCELLED');assert.equal(requests.length,2);
});

test('biometria: resposta recebida depois de abortar não é aceita',async()=>{
  let finish;
  const {instance}=client(url=>url.pathname==='/status'?json(ready):new Promise(resolve=>{finish=resolve}));
  await instance.discover();const controller=new AbortController(),pending=instance.capture({fingerCode:'R_INDEX',signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));
  controller.abort();finish(json({ok:true,realFingerImage:true,fingerImageDataUrl:pixel}));await assert.rejects(pending,error=>error.code==='BIO_CANCELLED');
});

test('biometria: imagem exige origem de captura declarada, MIME e assinatura de bytes coerentes',()=>{
  assert.equal(bio.extractImage({realFingerImage:true,fingerImageDataUrl:pixel}).src,pixel);
  assert.equal(bio.extractImage({realFingerImage:true,imageBase64:pixel.split(',')[1]}).src,pixel);
  for(const body of [
    {realFingerImage:false,fingerImageDataUrl:pixel},{realFingerImage:true},
    {realFingerImage:true,image:'https://example.invalid/biometria.png'},
    {realFingerImage:true,image:'data:image/svg+xml;base64,PHN2Zz4='},
    {realFingerImage:true,image:pixel.replace('image/png','image/jpeg')},
    {realFingerImage:true,image:'data:image/png;base64,'+Buffer.from('NOT-A-PNG').toString('base64')}
  ])assert.throws(()=>bio.extractImage(body),error=>/^BIO_IMAGE_/.test(error.code));
});

test('biometria: imagem acima de 150 KB é rejeitada e BMP mantém o tipo até decodificação',()=>{
  const bytes=Buffer.alloc(bio.MAX_IMAGE_BYTES+1);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  assert.throws(()=>bio.extractImage({realFingerImage:true,image:'data:image/png;base64,'+bytes.toString('base64')}),error=>error.code==='BIO_IMAGE_LARGE');
  const bmp=Buffer.alloc(54);bmp[0]=66;bmp[1]=77;bmp.writeInt32LE(1,18);bmp.writeInt32LE(1,22);
  const extracted=bio.extractImage({realFingerImage:true,imageBase64:bmp.toString('base64')});assert.equal(extracted.mime,'bmp');assert.ok(extracted.src.startsWith('data:image/bmp;'));
});

test('biometria: leitura limita resposta e diagnóstico não retém template ou imagem',async()=>{
  const {instance}=client(()=>json({...ready,template:'X'.repeat(17000)}));await assert.rejects(instance.discover());
  assert.ok(instance.getDiagnostics().every(item=>item.code==='BIO_RESPONSE_LARGE'));assert.ok(!JSON.stringify(instance.getDiagnostics()).includes('XXXXX'));
});


test('biometria: legado só permite diagnóstico e agente12.9.3 tem preferência na faixa local',async()=>{
  const legacy={...ready,version:'11.10.6',capabilities:undefined};
  const onlyLegacy=client(url=>url.port==='8789'?json(legacy):refused()).instance;
  const state=await onlyLegacy.discover();assert.equal(state.readerDetected,true);assert.equal(state.ready,false);assert.equal(state.upgradeRequired,true);
  await assert.rejects(onlyLegacy.capture({fingerCode:'R_INDEX'}),error=>error.code==='BIO_AGENT_UPDATE');
  const mixed=client(url=>url.port==='8789'?json(legacy):url.port==='8790'?json(ready):refused());
  assert.equal((await mixed.instance.discover()).port,8790);assert.equal(mixed.requests.length,2);
  assert.equal(bio.normalizeStatus({...ready,capabilities:undefined},8789).ready,false);
  assert.equal(bio.normalizeStatus({...ready,busy:true},8789).ready,false);
});

test('biometria: dimensões excessivas são rejeitadas antes da decodificação',()=>{
  const bytes=Buffer.from(pixel.split(',')[1],'base64');bytes.writeUInt32BE(100000,16);
  assert.throws(()=>bio.extractImage({realFingerImage:true,imageBase64:bytes.toString('base64')}),error=>error.code==='BIO_IMAGE_INVALID');
});


test('biometria: aguarda o diagnóstico assíncrono antes de permitir captura',async()=>{
  let calls=0;
  const {instance}=client(()=>json({...ready,checking:++calls<3}),{checkingTimeout:200,pollInterval:5});
  const state=await instance.discover();assert.equal(state.ready,true);assert.equal(calls,3);
  assert.equal(bio.normalizeStatus({...ready,checking:true},8789).ready,false);
});

test('biometria: diagnóstico que não termina permanece indisponível após prazo limitado',async()=>{
  const {instance}=client(url=>url.port==='8789'?json({...ready,checking:true}):refused(),{checkingTimeout:25,pollInterval:5});
  const started=Date.now(),state=await instance.discover();assert.equal(state.ready,false);assert.equal(state.checking,true);assert.ok(Date.now()-started<1000);
  await assert.rejects(instance.capture({fingerCode:'R_INDEX'}),error=>error.code==='BIO_CHECKING');
});

test('biometria: fallback12.9.3 distingue protocolo atualizado de captura indisponível por Java ou SDK',async()=>{
  for(const errorCode of ['JAVA_NOT_FOUND','JAVA_ARCH_MISMATCH','SDK_NOT_FOUND','SDK_DLL_NOT_FOUND','SDK_ARCH_MISMATCH']){
    const fallback={ok:false,version:'12.9.3',service:'JP Biometria Local',sdk:false,reader:false,deviceCount:0,runtime:'diagnostic-only',capabilities:{capture:false,captureMethod:'POST',capturePath:'/api/capture'},errorCode,message:'CAMINHO-PRIVADO-TEMPLATE-NAO-MOSTRAR'};
    const {instance,requests}=client(url=>url.port==='8789'?json(fallback):refused());
    const status=await instance.discover();assert.equal(status.compatible,true);assert.equal(status.upgradeRequired,false);assert.equal(status.captureAvailable,false);assert.equal(status.ready,false);assert.equal(status.code,errorCode);assert.equal(status.runtimeCode,errorCode);assert.ok(status.runtimeMessage.length>20);assert.ok(!status.runtimeMessage.includes('PRIVADO'));
    await assert.rejects(instance.capture({fingerCode:'R_INDEX'}),error=>error.code==='BIO_RUNTIME'&&!error.message.includes('precisa ser atualizado'));
    assert.ok(requests.every(request=>new URL(request.url).pathname==='/status'));
  }
  const unknown=bio.normalizeStatus({...ready,capabilities:{...ready.capabilities,capture:false},errorCode:'__proto__',message:'NAO-EXIBIR'},8789);assert.equal(unknown.ready,false);assert.equal(unknown.upgradeRequired,false);assert.equal(unknown.runtimeCode,'');assert.equal(unknown.runtimeMessage,'');
});

test('verificação automática requer permissão concedida e nunca captura',async()=>{
  for(const permission of ['prompt','denied','unsupported','granted']){
    const requests=[];
    const client=bio.createClient({queryPermission:async()=>{if(permission==='unsupported')throw new TypeError('PermissionName');return {state:permission};},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,text:async()=>JSON.stringify({ok:true,service:'JP Biometria',version:'12.9.3',reader:true,sdk:true,capabilities:{capture:true,captureMethod:'POST',capturePath:'/api/capture'}})};}});
    if(permission==='granted'){assert.equal((await client.discover({automatic:true})).ready,true);assert.equal(requests.length,1);assert.equal(requests[0].options.method,'GET');assert.ok(requests[0].url.includes('/status'));}
    else{await assert.rejects(client.discover({automatic:true}),{code:permission==='denied'?'BIO_PERMISSION':'BIO_PERMISSION_REQUIRED'});assert.equal(requests.length,0);}
  }
});

test('desempenho: porta alternativa pronta não aguarda timeout da porta principal',async()=>{
 const {instance,requests}=client((url,init)=>url.port==='8789'?pendingUntilAbort(url,init):url.port==='8790'?json(ready):refused(),{primaryStatusTimeout:1500,discoveryHedgeMs:20});
 const start=Date.now();assert.equal((await instance.discover()).port,8790);assert.ok(Date.now()-start<800);assert.equal(requests.length,2);assert.ok(requests.every(x=>x.init.method==='GET'));assert.equal(requests[0].init.signal.aborted,true);
});
test('desempenho: cancelamento interrompe as duas buscas e não seleciona leitor tardio',async()=>{
 const {instance}=client(pendingUntilAbort,{primaryStatusTimeout:1000,statusTimeout:1000,discoveryHedgeMs:1});
 const controller=new AbortController(),pending=instance.discover({signal:controller.signal});setTimeout(()=>controller.abort(),15);await assert.rejects(pending,{code:'BIO_CANCELLED'});assert.equal(instance.getStatus(),null);
});
test('agente Java: errorCode preserva divergência e erro do SDK sem expor mensagem arbitrária',async()=>{
 for(const code of ['BIOMETRIA_DIVERGENTE','BIOMETRIC_DEVICE_DIFFERENT','NITGEN_123','SDK_API_INCOMPATIBLE','READER_BUSY']){
  const {instance}=client(url=>url.pathname==='/status'?json({...ready,capabilities:{...ready.capabilities,verify:true,templates:true}}):json({ok:false,errorCode:code,message:'DADOS-PRIVADOS-NAO-EXIBIR'},422));
  await instance.discover();await assert.rejects(instance.biometric({kind:'verify'}),e=>e.code==='BIO_HTTP'&&e.agentCode===code&&!e.message.includes('DADOS-PRIVADOS')&&!e.message.includes('respondeu com erro'));
 }
});

test('cadastro com imagem exige agente compatível sem impedir assinatura de digitais antigas',()=>{assert.equal(bio.normalizeStatus({...ready,version:'12.9.0',capabilities:{...ready.capabilities,templates:true,verify:true}},8789).enrollmentImageAvailable,false);assert.equal(bio.normalizeStatus({...ready,version:'12.9.1',capabilities:{...ready.capabilities,templates:true,verify:true}},8789).enrollmentImageAvailable,true);});

test('recadastro encontra agente com imagem mesmo quando versão antiga responde primeiro',async()=>{const {instance}=client(url=>json({...ready,version:url.port==='8789'?'12.9.0':'12.9.3',capabilities:{...ready.capabilities,templates:true,verify:true}}));assert.equal((await instance.discover({requireEnrollmentImage:true})).port,8790);});
