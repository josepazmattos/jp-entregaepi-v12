import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createService, fail, NOTICE_VERSION } from './service.mjs';
import { store, provider, images, verifiedMfa } from './aws.mjs';
import { makePdf } from './pdf.mjs';
const verifier=CognitoJwtVerifier.create({userPoolId:process.env.USER_POOL_ID,tokenUse:'id',clientId:process.env.CLIENT_ID});
const service=createService({store,provider,images,endAt:process.env.PILOT_END,enabled:process.env.CAPTURE_ENABLED==='true'});
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
export function createHandler({verify,hasMfa,api,pdf=makePdf}) {
  return async event=>{
    const method=event.requestContext?.http?.method,path=event.rawPath||'';
    try{
      // API Gateway supplies the configured CORS headers. Preflight has no
      // authorization token and must never invoke a protected operation.
      if(method==='OPTIONS')return {statusCode:204,headers,body:''};
      if(method==='GET'&&path==='/health')return {statusCode:200,headers,body:JSON.stringify({ok:true,testOnly:true,version:'0.1.0',noticeVersion:NOTICE_VERSION})};
      const value=event.headers?.authorization||event.headers?.Authorization||'';
      if(!/^Bearer [A-Za-z0-9_.-]{50,16000}$/.test(value))fail(401,'LOGIN_REQUIRED','Entre com seu acesso Master.');
      const token=value.slice(7);let claims;try{claims=await verify(token);}catch{fail(401,'INVALID_SESSION','Sessão expirada. Entre novamente.');}
      if(!Array.isArray(claims['cognito:groups'])||!claims['cognito:groups'].includes('MASTER'))fail(403,'MASTER_REQUIRED','Este piloto é restrito ao Master.');
      if(!await hasMfa(token,claims))fail(403,'MFA_REQUIRED','Confirme o código de acesso do Master.');
      const owner=claims.sub;
      let body={};
      if(event.body){if(event.isBase64Encoded||Buffer.byteLength(event.body)>16384)fail(413,'BODY_LIMIT','Solicitação muito grande.');try{body=JSON.parse(event.body);}catch{fail(400,'INVALID_JSON','Solicitação inválida.');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'INVALID_BODY','Solicitação inválida.');}
      let data;
      if(method==='GET'&&path==='/records')data={items:await api.list(owner),captureEnabled:process.env.CAPTURE_ENABLED==='true',pilotEnd:process.env.PILOT_END};
      else if(method==='POST'&&path==='/sessions')data=await api.begin(owner,body);
      else if(method==='POST'&&path==='/sessions/complete')data=await api.complete(owner,body);
      else if(method==='POST'&&path==='/sessions/cancel')data=await api.cancel(owner,body.attemptId);
      else if(method==='DELETE'&&path==='/data')data=await api.clear(owner);
      else if(method==='GET'&&/^\/records\/(ENROLL|RECEIPT)\/[^/]+\/(pdf|evidence|json)$/.test(path)){
        const [, ,type,id,format]=path.split('/');const record=await api.record(owner,type,id);
        if(format==='json')data=record;
        else return {statusCode:200,isBase64Encoded:true,headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="TESTE-${type}-${id}${format==='evidence'?'-evidencias':''}.pdf"`},body:(await pdf(record,format==='evidence')).toString('base64')};
      }else fail(404,'NOT_FOUND','Rota não encontrada.');
      return {statusCode:200,headers,body:JSON.stringify({ok:true,...data})};
    }catch(error){
      const status=Number.isInteger(error.status)?error.status:503;
      if(status>=500)console.error(JSON.stringify({event:'FACIAL_PILOT_ERROR',code:error.code||error.name||'ERROR'}));
      return {statusCode:status,headers,body:JSON.stringify({ok:false,code:error.code||'UNAVAILABLE',error:status>=500?'O serviço não concluiu a verificação. Nenhuma confirmação foi registrada. Tente novamente.':error.message})};
    }
  };
}
export const handler=createHandler({verify:token=>verifier.verify(token),hasMfa:verifiedMfa,api:service});
