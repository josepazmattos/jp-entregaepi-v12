import {Router} from 'express';
import * as storage from '../db/store.js';
import {requireMaster,httpError} from '../middleware/auth.js';
import {empresaIdFrom,objectBody,ok} from './_helpers.js';
import {createDeviceService} from '../services/biometria-devices.js';
export function createDevicesRouter({store=storage}={}){
 const router=Router(),service=createDeviceService(store);
 router.use(requireMaster);
 router.use(async(req,res,next)=>{const id=empresaIdFrom(req);if(!id)throw httpError(400,'Selecione a empresa.','EMPRESA_OBRIGATORIA');const company=await store.get('empresa',id);if(!company||company.excluidaEm)throw httpError(403,'Empresa indisponível.','EMPRESA_EXCLUIDA');req.deviceCompany=id;if(req.method==='POST'&&(!req.auth.authTime||Date.now()/1000-req.auth.authTime>600))throw httpError(401,'Confirme novamente a senha Master para autorizar este computador.','BIOMETRIA_REAUTENTICAR');next();});
 router.get('/',async(req,res)=>ok(res,{items:await service.list(req.deviceCompany)}));
 router.post('/desafio',async(req,res)=>ok(res,{challenge:await service.start(req.deviceCompany,req.auth.sub,objectBody(req).name)}));
 router.post('/desafio/:id',async(req,res)=>ok(res,{item:await service.confirm(req.deviceCompany,req.auth.sub,req.params.id,objectBody(req))}));
 router.post('/:id/desativar',async(req,res)=>ok(res,{item:await service.disable(req.deviceCompany,req.auth.sub,req.params.id,objectBody(req).version)}));
 return router;
}
export default createDevicesRouter();
