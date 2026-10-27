import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfaSessions, requireVerifiedMaster, tokenHash } from '../src/security/session.js';
import { createAuthSecurity } from '../src/security/auth-handler.js';
import { createIsolatedHandler } from '../src/security/isolated-handler.js';
import { alertSummary } from '../src/security/alert-handler.js';
const now=Math.floor(Date.now()/1000),master={sub:'master-sub',auth_time:now,exp:now+3600,'cognito:groups':['MASTER']},company={sub:'worker-sub',auth_time:now,exp:now+3600,'cognito:groups':['EMPRESA'],'custom:empresa_id':'A'};
test('MFA is bound to the exact token, subject, authentication time and expiry',async()=>{
  const rows=new Map(),sessions=createMfaSessions({table:'test',client:{send:async c=>{if(c.constructor.name==='PutCommand'){rows.set(c.input.Item.pk,c.input.Item);return {};}return {Item:rows.get(c.input.Key.pk)};}}});
  assert.equal(await sessions.verified('one',master),false);await sessions.record('one',master);
  assert.equal(await sessions.verified('one',master),true);assert.equal(await sessions.verified('two',master),false);
  assert.equal(await sessions.verified('one',{...master,sub:'other'}),false);assert.equal(await sessions.verified('one',{...master,auth_time:now-1}),false);
  rows.get('MFA#'+tokenHash('one')).expiresAtEpoch=now-1;assert.equal(await sessions.verified('one',master),false);
});
test('Master cannot use a password-only token or stale privileged authentication',async()=>{
  await assert.rejects(requireVerifiedMaster('t',master,{sessions:{verified:async()=>false}}),{code:'MFA_REQUIRED'});
  await assert.rejects(requireVerifiedMaster('t',{...master,auth_time:now-601},{recent:true,sessions:{verified:async()=>true}}),{code:'CERTIFICADO_REAUTENTICAR'});
  await assert.rejects(requireVerifiedMaster('t',company,{sessions:{verified:async()=>true}}),{code:'PERFIL_NAO_AUTORIZADO'});
});
test('only a Cognito-completed MFA challenge creates a verified session',async()=>{
  const recorded=[],calls=[],auth=createAuthSecurity({appClient:'client',verify:async token=>{assert.equal(token,'issued-by-cognito');return master;},cognito:{send:async c=>{calls.push(c.input);return {AuthenticationResult:{IdToken:'issued-by-cognito'}};}},sessions:{record:async(...args)=>recorded.push(args)},log:()=>{}});
  let result=await auth({action:'challenge',username:'master',session:'s'.repeat(50),code:'123456',IdToken:'attacker'});
  assert.equal(result.ok,true);assert.equal(recorded.length,1);assert.equal(recorded[0][0],'issued-by-cognito');assert.equal(calls[0].ChallengeName,'SOFTWARE_TOKEN_MFA');
  result=await auth({action:'challenge',username:'master',session:'s'.repeat(50),code:'invalid'});assert.equal(result.ok,false);assert.equal(recorded.length,1);
  const bad=createAuthSecurity({cognito:{send:async()=>{throw Object.assign(new Error('bad'),{name:'CodeMismatchException'});}},sessions:{record:async()=>assert.fail()},log:()=>{}});
  assert.equal((await bad({action:'challenge',username:'master',session:'s'.repeat(50),code:'123456'})).ok,false);
});
test('isolated signer verifies JWT, tenant, ficha and rejects arbitrary input',async()=>{
  const calls=[],handler=createIsolatedHandler({mode:'signer',verify:async()=>company,database:{get:async(type,id)=>type==='empresa'?{id}: {id,empresaId:id==='foreign'?'B':'A'}},gedService:{prepare:async(...a)=>{calls.push(a);return {jobId:'job'};}},log:()=>{}});
  assert.equal((await handler({action:'prepare',company:'B',id:'f',token:'t'})).status,403);
  assert.equal((await handler({action:'prepare',company:'A',id:'foreign',token:'t'})).status,403);
  assert.equal((await handler({action:'prepare',company:'A',id:'f',token:'t',digest:'arbitrary'})).status,400);
  assert.equal((await handler({action:'start',company:'A',id:'f',token:'t'})).status,403);
  assert.equal((await handler({action:'prepare',company:'A',id:'f',token:'t'})).ok,true);assert.equal(calls.length,1);assert.equal(calls[0][1],company.sub);
  const forged=createIsolatedHandler({mode:'signer',verify:async()=>{throw Object.assign(new Error('invalid'),{status:401});},database:{get:async()=>assert.fail()},log:()=>{}});assert.equal((await forged({action:'prepare',company:'A',id:'f',token:'fake'})).status,401);
});
test('vault administration requires recent Master MFA and rejects sign and plaintext secrets',async()=>{
  const opts={mode:'admin',verify:async()=>master,sessions:{verified:async()=>true},database:{get:async()=>({id:'A'})},gedService:{vaultAdmin:{start:async()=>({id:'import'})}},log:()=>{}};
  const handler=createIsolatedHandler(opts);
  assert.equal((await handler({action:'sign',company:'A',token:'t'})).status,403);
  assert.equal((await handler({action:'start',company:'A',token:'t',body:{password:'must-never-pass'}})).status,400);
  assert.equal((await handler({action:'start',company:'A',token:'t',body:{chain:['public']}})).ok,true);
  assert.equal((await createIsolatedHandler({...opts,sessions:{verified:async()=>false}})({action:'start',company:'A',token:'t'})).code,'MFA_REQUIRED');
  assert.equal((await createIsolatedHandler({...opts,verify:async()=>company})({action:'start',company:'A',token:'t'})).status,403);
});
test('alerts do not reproduce untrusted event payloads or accept arbitrary recipients',()=>{
  const result=alertSummary({source:'aws.kms',detail:{eventSource:'kms.amazonaws.com',eventName:'PutKeyPolicy',requestParameters:{password:'PRIVATE'}}});assert.equal(result.operation,'PutKeyPolicy');assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(alertSummary({source:'unknown',detail:{eventName:'PutKeyPolicy'}}),null);
});
test('company account administration cannot promote a caller or target an arbitrary Cognito user',async()=>{
  let record={id:'A',login:'company-login',cnpj:'12345678000195',cognitoSub:'company-sub',_accessRegistration:{requestId:'reserved',startedBy:master.sub}},calls=[];
  const opts={mode:'admin',verify:async()=>master,sessions:{verified:async()=>true},database:{get:async()=>record},accounts:{ensureCompanyAccess:async p=>{calls.push(p);return {sub:'company-sub'};},resetCompanyPassword:async p=>{calls.push(p);return {trocaObrigatoria:true};}},log:()=>{}};
  const h=createIsolatedHandler(opts);
  assert.equal((await h({action:'account-ensure',company:'A',token:'t',body:{username:'master',group:'MASTER'}})).status,400);
  assert.equal((await createIsolatedHandler({...opts,verify:async()=>company})({action:'account-ensure',company:'A',token:'t'})).status,403);
  assert.equal((await createIsolatedHandler({...opts,sessions:{verified:async()=>false}})({action:'account-ensure',company:'A',token:'t'})).code,'MFA_REQUIRED');
  assert.equal((await h({action:'account-ensure',company:'A',token:'t'})).ok,true);assert.equal(calls[0].login,'company-login');assert.equal(calls[0].expectedSub,'company-sub');
  assert.equal((await h({action:'account-reset',company:'A',token:'t'})).status,409);
  record._passwordReset={actor:'another-master',status:'processando',startedAt:new Date().toISOString()};assert.equal((await h({action:'account-reset',company:'A',token:'t'})).status,409);
  record._passwordReset.actor=master.sub;assert.equal((await h({action:'account-reset',company:'A',token:'t'})).ok,true);assert.equal(calls[1].username,'company-login');
});
test('email MFA forwards only the bound Cognito challenge and rejects other challenge types',async()=>{
  const calls=[],proofs=[];
  const auth=createAuthSecurity({appClient:'client',verify:async()=>master,cognito:{send:async c=>{calls.push(c.input);return {AuthenticationResult:{IdToken:'email-issued'}};}},sessions:{record:async t=>proofs.push(t)},log:()=>{}});
  const request={action:'challenge',username:'master',session:'email-session-1234567890',code:'123456',challengeName:'EMAIL_OTP',IdToken:'forged',email:'attacker@example.test'};
  assert.equal((await auth(request)).ok,true);
  assert.deepEqual(calls[0],{ClientId:'client',ChallengeName:'EMAIL_OTP',Session:request.session,ChallengeResponses:{USERNAME:'master',EMAIL_OTP_CODE:'123456'}});
  assert.deepEqual(proofs,['email-issued']);
  for(const challengeName of ['PASSWORD','NEW_PASSWORD_REQUIRED','CUSTOM_CHALLENGE','__proto__','toString',null])assert.equal((await auth({...request,challengeName})).code,'MFA_METHOD_INVALID');
  assert.equal(calls.length,1);
  const incomplete=createAuthSecurity({cognito:{send:async()=>({ChallengeName:'EMAIL_OTP',Session:'next',AuthenticationResult:{IdToken:'must-not-record'}})},sessions:{record:async()=>assert.fail('incomplete challenge recorded')},log:()=>{}});
  assert.equal((await incomplete(request)).code,'MFA_NOT_COMPLETED');
});
test('concurrent Master email challenges produce independent session proofs',async()=>{
  const recorded=new Set(),auth=createAuthSecurity({verify:async()=>master,cognito:{send:async c=>({AuthenticationResult:{IdToken:c.input.Session}})},sessions:{record:async t=>recorded.add(t)},log:()=>{}});
  const results=await Promise.all(['A','B'].map(id=>auth({action:'challenge',username:'master',session:id.repeat(30),code:'123456',challengeName:'EMAIL_OTP'})));
  assert.ok(results.every(x=>x.ok));assert.equal(recorded.size,2);
});
test('Master status recognizes email MFA without exposing the email address',async()=>{
  const auth=createAuthSecurity({verify:async()=>master,sessions:{verified:async()=>false},cognito:{send:async()=>({UserMFASettingList:['EMAIL_OTP'],UserAttributes:[{Name:'email',Value:'private@example.test'}]})},log:()=>{}});
  const result=await auth({action:'status',token:'password-only'});
  assert.equal(result.data.method,'email');assert.equal(result.data.enrolled,true);assert.equal(result.data.verified,false);assert.ok(!JSON.stringify(result).includes('private@'));
});
