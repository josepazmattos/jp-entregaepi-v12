import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLivenessDetectorCore} from '@aws-amplify/ui-react-liveness';
import {ThemeProvider} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './styles.css';
import {displayText} from './i18n.js';
import {auth,logout,login,finishMfa} from './auth.js';

const NOTICE='JP-FACIAL-PILOTO-2026-10-30-v1';
const STATEMENT='Confirmo, exclusivamente neste teste, os equipamentos e quantidades apresentados nesta ficha. Este documento não registra uma entrega real de EPI.';
async function api(path,body,method=body?'POST':'GET'){
  const token=auth()?.idToken;if(!token)throw Error('Entre com seu acesso Master.');
  const r=await fetch(window.JP_FACIAL_CONFIG.apiUrl+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const v=await r.json();if(!r.ok||v.ok===false){const e=Error(v.error||'Não foi possível concluir.');e.status=r.status;throw e;}return v;
}
const stopCamera=()=>document.querySelectorAll('video').forEach(v=>v.srcObject?.getTracks?.().forEach(t=>t.stop()));
function App(){
  const [signedIn,setSignedIn]=useState(Boolean(auth())),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[challenge,setChallenge]=useState(null);
  const [method,setMethod]=useState('FACIAL'),[tab,setTab]=useState('enroll'),[records,setRecords]=useState([]),[selected,setSelected]=useState(''),[live,setLive]=useState(null),[preview,setPreview]=useState(null);
  const [voluntary,setVoluntary]=useState(false),[identity,setIdentity]=useState(false),[accepted,setAccepted]=useState(false),[name,setName]=useState(''),[company,setCompany]=useState('EMPRESA DE TESTE');
  const [items,setItems]=useState([{description:'Capacete de segurança',quantity:1,ca:''}]),[online,setOnline]=useState(navigator.onLine),[pilot,setPilot]=useState({captureEnabled:false});
  const epoch=useRef(0),attempt=useRef(null),completing=useRef(false);
  const enrollments=records.filter(r=>r.type==='ENROLL'&&r.state==='ACTIVE');
  const cancel=async(messageText='Captura encerrada. Nenhuma nova confirmação foi solicitada.')=>{
    epoch.current++;const old=attempt.current;attempt.current=null;completing.current=false;stopCamera();setLive(null);setPreview(null);setBusy(false);setAccepted(false);setMessage(messageText);
    if(old)await api('/sessions/cancel',{attemptId:old.attemptId}).catch(()=>{});
  };
  async function refresh(){const r=await api('/records');setRecords(r.items);setPilot(r);return r;}
  useEffect(()=>{if(signedIn)refresh().catch(e=>{setMessage(e.message);if([401,403].includes(e.status)){logout();setSignedIn(false);}});},[signedIn]);
  useEffect(()=>{
    const network=()=>{setOnline(navigator.onLine);if(!navigator.onLine)cancel('Sem internet. A captura foi encerrada e não foi confirmada.');};
    const hidden=()=>{if(document.hidden&&attempt.current)cancel('A captura foi encerrada ao sair da tela. Inicie novamente.');};
    window.addEventListener('offline',network);window.addEventListener('online',network);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('offline',network);window.removeEventListener('online',network);document.removeEventListener('visibilitychange',hidden);stopCamera();};
  },[]);
  async function run(task){setBusy(true);setMessage('');try{await task();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  async function begin(){
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){setMessage('A câmera exige HTTPS e um navegador compatível.');return;}
    const generation=++epoch.current;setBusy(true);setMessage('Preparando a verificação...');
    try{
      const request={requestId:crypto.randomUUID(),noticeVersion:NOTICE,voluntary,kind:tab==='enroll'?'ENROLL':'VERIFY',...(tab==='enroll'?{name,company,identityChecked:identity}:{method:'FACIAL',enrollmentId:selected,receiptAccepted:accepted,items})};
      const session=await api('/sessions',request);
      if(epoch.current!==generation){api('/sessions/cancel',{attemptId:session.attemptId}).catch(()=>{});return;}
      attempt.current=session;setPreview(session.snapshot);setLive({...session,generation});setMessage('Confira as orientações e inicie a captura.');
    }catch(e){if(epoch.current===generation)setMessage(e.message);}finally{if(epoch.current===generation)setBusy(false);}
  }
  async function complete(session){
    if(completing.current||epoch.current!==session.generation)return;completing.current=true;setBusy(true);setMessage('Captura recebida. Aguardando a validação no servidor...');
    try{
      let result;
      for(let n=0;n<4;n++){
        if(epoch.current!==session.generation)return;
        result=await api('/sessions/complete',{attemptId:session.attemptId,contentHash:session.contentHash});
        if(!result.pending)break;await new Promise(r=>setTimeout(r,1000));
      }
      if(epoch.current!==session.generation)return;
      stopCamera();setLive(null);setPreview(null);attempt.current=null;
      if(result.approved){setMessage(result.record.type==='ENROLL'?'Cadastro facial de teste concluído. Agora você pode testar uma entrega.':'Verificação facial aprovada no teste. A ficha e as evidências estão disponíveis abaixo.');if(result.record.type==='ENROLL'){setSelected(result.record.id);setTab('verify');}await refresh();}
      else setMessage(result.message||'O resultado não foi confirmado. Faça uma nova tentativa.');
      setVoluntary(false);setIdentity(false);setAccepted(false);
    }catch(e){if(epoch.current===session.generation){await cancel('Não foi possível confirmar: '+e.message);await refresh().catch(()=>{});}}
    finally{if(epoch.current===session.generation){completing.current=false;setBusy(false);}}
  }
  async function download(record,format){
    await run(async()=>{
      const r=await fetch(window.JP_FACIAL_CONFIG.apiUrl+`/records/${record.type}/${record.id}/${format}`,{headers:{Authorization:'Bearer '+auth()?.idToken}});
      if(!r.ok){const e=await r.json();throw Error(e.error||'Documento indisponível.');}
      const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`TESTE-${record.type}-${record.id}${format==='evidence'?'-evidencias':''}.${format==='json'?'json':'pdf'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    });
  }
  const locked=busy||Boolean(live);
  return <ThemeProvider><header><img src="/EntregaEPI/assets/logo-jp.png" alt="JP Segurança do Trabalho"/><div><strong>EntregaEPI</strong><span>Teste de biometria facial</span></div><span className="badge">PILOTO</span></header>
    <main><section className="intro"><p className="eyebrow">ENTREGA EM CAMPO</p><h1>Uma entrega.<br/>Um método de confirmação.</h1><p>Teste o reconhecimento facial pela câmera. A leitura digital NITGEN continua no aplicativo atual.</p><div className="notice">Ambiente de teste: não gera entrega real, não altera estoque e não envia fichas ao V10. Os PDFs não utilizam o certificado A1.</div></section>
    {!signedIn?<section className="card login"><h2>Acesso Master</h2><p>Use seu login habitual e a verificação de acesso já cadastrada.</p><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);run(async()=>{if(challenge){await finishMfa(challenge,String(data.get('code')));setChallenge(null);setSignedIn(true);}else{const next=await login(String(data.get('username')),String(data.get('password')));setChallenge(next);if(!next)setSignedIn(true);}});e.currentTarget.querySelector('input[type=password]')?.setAttribute('value','');}}>
      {challenge?<><label>Código de acesso<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus/></label><p>{challenge.challengeName==='EMAIL_OTP'?'Confira o código enviado ao e-mail do Master.':'Informe o código do autenticador.'}</p></>:<><label>Usuário<input name="username" autoComplete="username" required/></label><label>Senha<input name="password" type="password" autoComplete="current-password" required/></label></>}
      <button disabled={busy}>{busy?'Verificando...':challenge?'CONFIRMAR CÓDIGO':'ENTRAR NO TESTE'}</button>{challenge&&<button className="secondary" type="button" onClick={()=>setChallenge(null)}>VOLTAR</button>}</form></section>:<>
      <div className="toolbar"><span>Master: {auth()?.username}</span><button className="text" onClick={()=>{cancel('');logout();setSignedIn(false);setRecords([]);}}>SAIR DO TESTE</button></div>
      <section className="card"><h2>Escolha o método</h2><div className="method-options" role="group" aria-label="Método de confirmação"><button className={method==='DIGITAL'?'selected':'secondary'} aria-pressed={method==='DIGITAL'} onClick={()=>{cancel('');setMethod('DIGITAL');}}>DIGITAL NITGEN</button><button className={method==='FACIAL'?'selected':'secondary'} aria-pressed={method==='FACIAL'} onClick={()=>{if(method!=='FACIAL')cancel('');setMethod('FACIAL');}}>FACIAL PELA CÂMERA</button></div>
      {method==='DIGITAL'?<div className="digital"><h3>Leitura digital preservada</h3><p>Continue pelo procedimento já utilizado com o leitor. O teste facial não solicita a digital.</p><a className="button" href="/EntregaEPI/">ABRIR ENTREGA EPI ATUAL</a></div>:<>
        <div className="tabs"><button className={tab==='enroll'?'selected':'text'} disabled={locked} onClick={()=>{setTab('enroll');setVoluntary(false);}}>1. CADASTRAR ROSTO</button><button className={tab==='verify'?'selected':'text'} disabled={locked} onClick={()=>{setTab('verify');setVoluntary(false);}}>2. TESTAR ENTREGA</button></div>
        <fieldset disabled={locked}>
        {tab==='enroll'?<><h3>Cadastro facial de teste</h3><div className="grid"><label>Nome ou identificação do participante<input value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="Participante voluntário"/></label><label>Empresa de teste<input value={company} maxLength={120} onChange={e=>setCompany(e.target.value)}/></label></div><label className="check"><input type="checkbox" checked={identity} onChange={e=>setIdentity(e.target.checked)}/>Como responsável, conferi a identidade do participante para este cadastro de teste.</label></>:<><h3>Confira a ficha de teste</h3><label>Participante cadastrado<select value={selected} onChange={e=>{setSelected(e.target.value);setAccepted(false);}}><option value="">Selecione um cadastro facial</option>{enrollments.map(r=><option key={r.id} value={r.id}>{r.name} — {r.company}</option>)}</select></label>{!enrollments.length&&<p>Cadastre primeiro o rosto de um participante voluntário.</p>}
          {items.map((item,i)=><div className="item-row" key={i}><label>Equipamento<input value={item.description} maxLength={120} onChange={e=>{setItems(items.map((v,n)=>n===i?{...v,description:e.target.value}:v));setAccepted(false);}}/></label><label>Quantidade<input type="number" min="1" max="1000" value={item.quantity} onChange={e=>{setItems(items.map((v,n)=>n===i?{...v,quantity:Number(e.target.value)}:v));setAccepted(false);}}/></label><label>CA (se aplicável)<input inputMode="numeric" value={item.ca} maxLength={8} onChange={e=>{setItems(items.map((v,n)=>n===i?{...v,ca:e.target.value}:v));setAccepted(false);}}/></label>{items.length>1&&<button type="button" className="text" onClick={()=>{setItems(items.filter((_,n)=>n!==i));setAccepted(false);}}>REMOVER ITEM</button>}</div>)}
          <button type="button" className="secondary" disabled={items.length>=20} onClick={()=>{setItems([...items,{description:'',quantity:1,ca:''}]);setAccepted(false);}}>ADICIONAR ITEM</button><label className="check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>{STATEMENT}</label></>}
        <details className="privacy" open><summary>Aviso ao participante do teste</summary><p>Participação voluntária, apenas para adultos. Não condiciona emprego nem fornecimento de EPI. Você pode recusar, interromper e pedir a exclusão dos registros deste piloto ao Master.</p><p>A JP usará o vídeo facial para testar prova de vida e comparação de rosto no AWS Rekognition, em São Paulo. O app guarda imagens de referência e evidências com acesso restrito por até 7 dias de disponibilidade; a remoção automática pode levar tempo adicional. Não guardamos o vídeo no aplicativo.</p><p><strong>Atenção:</strong> a conta AWS ainda não possui política de exclusão do uso de conteúdo para melhoria dos serviços de IA do fornecedor. Use somente seu próprio rosto, voluntariamente, se concordar com essa condição. Não use esta etapa para cadastrar empregados em rotina.</p><p>O teste usa luzes coloridas. Pessoas com fotossensibilidade podem optar por não participar. Dúvidas e solicitações: sac@jptreinamentos.com.br.</p></details>
        <label className="check consent"><input type="checkbox" checked={voluntary} onChange={e=>setVoluntary(e.target.checked)}/>Eu, participante adulto, li o aviso acima e concordo voluntariamente com a captura e o tratamento descritos, somente para este teste.</label>
        </fieldset>
        {!live&&<><p className="hint">Use Safari ou Chrome atualizado, câmera frontal, boa iluminação, internet e celular na vertical. Aumente o brilho da tela.</p><button disabled={locked||!online||!pilot.captureEnabled||!voluntary||(tab==='enroll'?(!identity||!name.trim()||!company.trim()):(!selected||!accepted))} onClick={begin}>{busy?'PREPARANDO...':tab==='enroll'?'INICIAR CADASTRO FACIAL':'CONFIRMAR FICHA POR ROSTO'}</button>{!pilot.captureEnabled&&<p>Novas capturas ainda não estão liberadas neste ambiente.</p>}</>}
        {live&&<div className="capture"><div className="capture-summary"><strong>{preview?.name}</strong><span>{tab==='enroll'?'Cadastro facial':`${preview?.items?.length||0} item(ns) na ficha de teste`}</span><button className="secondary" onClick={()=>cancel()}>CANCELAR CAPTURA</button></div><FaceLivenessDetectorCore key={live.attemptId} sessionId={live.sessionId} region={live.region} config={{credentialProvider:async()=>({...live.credentials,expiration:new Date(live.credentials.expiration)})}} displayText={displayText} onAnalysisComplete={()=>complete(live)} onUserCancel={()=>cancel()} onError={e=>cancel(e.state==='CAMERA_ACCESS_ERROR'?'Permita o uso da câmera nas configurações do navegador e tente novamente.':e.state==='MOBILE_LANDSCAPE_ERROR'?'Coloque o celular na vertical e inicie outra tentativa.':'A captura não foi concluída. Confira câmera, iluminação e conexão e tente novamente.')}/></div>}
      </>}</section>
      <section className="card"><div className="record-heading"><h2>Cadastros e fichas de teste</h2><button className="secondary" disabled={locked} onClick={()=>run(refresh)}>ATUALIZAR</button></div><p>Disponíveis por 7 dias. A ficha e o relatório podem ser baixados e impressos quando necessário.</p><div className="records">{records.length?records.map(r=><article key={r.id}><div><span className="record-type">{r.type==='ENROLL'?'CADASTRO FACIAL':'FICHA DE TESTE'}</span><h3>{r.name}</h3><p>{r.company} · {new Date(r.createdAt).toLocaleString('pt-BR')}</p><small>Protocolo: {r.id}</small></div><div className="record-buttons"><button className="secondary" disabled={locked} onClick={()=>download(r,'pdf')}>BAIXAR PDF</button><button className="text" disabled={locked} onClick={()=>download(r,'evidence')}>EVIDÊNCIAS PDF</button><button className="text" disabled={locked} onClick={()=>download(r,'json')}>EVIDÊNCIAS JSON</button></div></article>):<p>Nenhum registro neste piloto.</p>}</div>{records.length>0&&<button className="danger" disabled={locked} onClick={()=>{if(window.confirm('Excluir todos os seus cadastros e fichas deste teste? O aplicativo principal não será alterado.'))run(async()=>{await api('/data',null,'DELETE');await refresh();setSelected('');setMessage('Seus registros do piloto foram excluídos.');});}}>EXCLUIR MEUS DADOS DE TESTE</button>}</section>
    </>}
    {message&&<div className="status" role="status" aria-live="polite">{message}</div>}{!online&&<div role="alert" className="status error">Sem conexão. Capturas e confirmações estão indisponíveis.</div>}
    <footer>JP Segurança do Trabalho · Piloto facial 0.1.0 · Digital ou facial, uma opção por entrega.</footer></main>
  </ThemeProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
