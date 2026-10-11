import {openA1} from './core.js';
let session=null,busy=false;
self.onmessage=async({data})=>{
  const {id,action}=data||{};
  if(busy)return self.postMessage({id,error:'Aguarde a etapa atual.'});
  busy=true;
  try{
    let result;
    if(action==='open'&&!session){session=await openA1(data.file,data.password,data.company);data.password='';result=session.info;}
    else if(action==='prove'&&session)result=await session.prove(data.configuration);
    else if(action==='wrap'&&session)result=await session.wrap(data.wrappingKey);
    else throw Error('Etapa de instalação inválida. Reinicie a instalação.');
    self.postMessage({id,result});
  }catch(error){session?.dispose();session=null;self.postMessage({id,error:error.message||'Não foi possível abrir o certificado.'});}
  finally{busy=false;}
};
