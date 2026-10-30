import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLivenessDetectorCore} from '@aws-amplify/ui-react-liveness';
import {ThemeProvider} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import {displayText} from './i18n.js';
window.JP_FACIAL_WIDGET={mount(node,session,events){
 const root=createRoot(node);let active=true;
 const stop=()=>node.querySelectorAll('video').forEach(v=>v.srcObject?.getTracks?.().forEach(t=>t.stop()));
 root.render(<ThemeProvider><FaceLivenessDetectorCore sessionId={session.sessionId} region={session.region} config={{credentialProvider:async()=>({...session.credentials,expiration:new Date(session.credentials.expiration)})}} displayText={displayText} onAnalysisComplete={()=>{if(active)events.complete();}} onUserCancel={()=>{if(active)events.cancel();}} onError={error=>{if(active)events.error(error.state==='CAMERA_ACCESS_ERROR'?'Permita o uso da câmera e inicie novamente.':error.state==='MOBILE_LANDSCAPE_ERROR'?'Coloque o celular na vertical e inicie novamente.':'A captura não foi concluída. Confira a iluminação e a conexão e inicie novamente.');}}/></ThemeProvider>);
 return ()=>{if(!active)return;active=false;stop();root.unmount();stop();};
}};
