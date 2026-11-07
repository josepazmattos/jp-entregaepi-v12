// One-off IAM-invoked maintenance, deployed only as an isolated temporary function.
// No HTTP endpoint. Scope is pinned to the two documents identified on 2026-11-07.
import * as store from './src/db/store.js';
import {gedStorage} from './src/db/jpged.js';
import {createGedService} from './src/services/jpged.service.js';
const targets=[
  {company:'102ae256-56af-4539-8a2e-049ad994dc1e',id:'ecd4978a-ce67-41bd-946a-681dc878744a'},
  {company:'774f7fb1-ede8-45ed-bf8d-30b564f24654',id:'fbe6137c-fe4e-4ba3-a2e8-dc344861b44d'}
];
export async function handler(event){
  if(process.env.AWS_LAMBDA_FUNCTION_NAME!=='jp-entregaepi-orientation-maintenance-20261107'||!['inspect','apply'].includes(event?.action))throw new Error('MAINTENANCE_SCOPE');
  const service=createGedService({ged:gedStorage,store}),result=[];
  for(const target of targets){
    const ficha=await store.get('ficha',target.id);
    if(!ficha||ficha.empresaId!==target.company||ficha.modeloFicha?.id!=='JP-EPI-2026.11'||ficha.orientacao?.confirmada||ficha.certificacao?.documentId!==target.id)throw new Error('MAINTENANCE_RECORD_CHANGED');
    if(event.action==='inspect'){const certificate=await service.certificate(target.company);result.push({...target,certificateAvailable:!!certificate,certificateActive:certificate?.active,certificateMode:certificate?.mode});}
    else {try{result.push({...target,result:await service.reissueLayout(target.company,'maintenance:orientation:20261107',target.id)});}catch(e){result.push({...target,error:e.code||e.name,message:e.message});}}
  }
  return {action:event.action,results:result};
}
