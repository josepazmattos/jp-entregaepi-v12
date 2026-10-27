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
