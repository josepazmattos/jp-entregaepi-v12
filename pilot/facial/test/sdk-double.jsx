// Browser contract tests only. This module is never included in the published bundle.
import React,{useRef,useState,useEffect} from 'react';
export function FaceLivenessDetectorCore({onAnalysisComplete,onError}){
  const video=useRef(),stream=useRef(),[ready,setReady]=useState(false);
  useEffect(()=>()=>{stream.current?.getTracks().forEach(t=>t.stop());},[]);
  async function start(){try{stream.current=await navigator.mediaDevices.getUserMedia({video:true,audio:false});window.syntheticTracks=stream.current.getTracks();video.current.srcObject=stream.current;await video.current.play();setReady(true);}catch(error){onError({state:'CAMERA_ACCESS_ERROR',error});}}
  return <div><p>CÂMERA SINTÉTICA - TESTE AUTOMATIZADO</p><video ref={video} muted playsInline style={{width:'100%'}}/><button onClick={start}>ABRIR CÂMERA SIMULADA</button><button disabled={!ready} onClick={onAnalysisComplete}>CONCLUIR CÂMERA SIMULADA</button></div>;
}
