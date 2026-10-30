import {Router} from 'express';
import {requireMaster,httpError} from '../middleware/auth.js';
import {objectBody,ok} from './_helpers.js';
import {facialControl} from '../services/facial-instance.js';
const router=Router();
router.use(requireMaster);
router.get('/',async(req,res)=>ok(res,await facialControl.view()));
router.put('/',async(req,res)=>{
 const body=objectBody(req);
 if(body.enabled!==false&&req.auth.authTime*1000<Date.now()-15*60000)throw httpError(403,'Entre novamente como Master para alterar a liberação facial.','FACIAL_MASTER_RECENTE');
 ok(res,await facialControl.update({actor:req.auth.sub,body}));
});
export default router;
