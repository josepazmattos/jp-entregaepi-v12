import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/db/store.js';
import {createFacialControl} from '../src/services/facial-control.service.js';
import {createFacialService} from '../src/services/facial.service.js';
function fixture(){
 const store=createStore({allowMemory:true}),state={ready:true,privacy:true,used:7},clock=()=>Date.parse('2026-10-30T12:00:00Z');
 const provider={privacyReady:async()=>{if(state.privacy==='error')throw Error('temporary AWS error');return state.privacy;},quotaUsage:async()=>({total:state.used})};
 const control=createFacialControl({store,provider,ready:()=>state.ready,clock});
 const body=changes=>({enabled:true,version:0,requestId:randomUUID(),endAt:'2026-11-06T11:32:46Z',remainingLimit:50,dailyLimit:20,acknowledgeCosts:true,acknowledgeGovernance:true,...changes});
 return {store,state,control,body,service:createFacialService({store,provider,settings:control.settings,clock})};
}
test('Master ativa e renova pelo banco sem atualizar código; cota usada não é zerada',async()=>{
 const f=fixture();assert.equal((await f.service.status()).enabled,false);const first=await f.control.update({actor:'master',body:f.body()});assert.equal(first.active,true);assert.equal(first.config.totalLimit,57);assert.equal(first.remaining,50);assert.equal((await f.service.status()).enabled,true);
 const renewed=await f.control.update({actor:'master',body:f.body({version:1,remainingLimit:100,endAt:'2026-12-01T12:00:00Z'})});assert.equal(renewed.config.totalLimit,107);assert.equal((await f.service.status()).endAt,'2026-12-01T12:00:00.000Z');assert.equal((await f.store.list('facial_config_audit')).length,2);
});
test('ativar exige infraestrutura, opt-out atual da AWS, custos e governança; não há bypass',async()=>{
 const f=fixture();f.state.ready=false;await assert.rejects(f.control.update({actor:'master',body:f.body()}),{code:'FACIAL_SETUP_PENDENTE'});f.state.ready=true;
 for(const privacy of [false,'error']){f.state.privacy=privacy;await assert.rejects(f.control.update({actor:'master',body:f.body()}),{code:'FACIAL_PRIVACIDADE_PENDENTE'});}f.state.privacy=true;
 for(const change of [{acknowledgeCosts:false},{acknowledgeGovernance:false}])await assert.rejects(f.control.update({actor:'master',body:f.body(change)}),{code:'FACIAL_CONFIG_ACEITE'});
 assert.equal((await f.store.list('facial_config_audit')).length,0);
});
test('privacidade é reavaliada sem deploy; falha impede nova captura e pausa continua disponível',async()=>{
 const f=fixture();await f.control.update({actor:'master',body:f.body()});assert.equal((await f.service.status()).enabled,true);
 f.state.privacy=false;assert.equal((await f.service.status()).enabled,false);f.state.privacy=true;assert.equal((await f.service.status()).enabled,true);
 f.state.privacy='error';const r=await f.control.update({actor:'master',body:f.body({enabled:false,version:1})});assert.equal(r.config.enabled,false);assert.equal((await f.service.status()).enabled,false);
});
test('reenvio não acrescenta cota nem duplica auditoria; solicitação alterada e versão obsoleta são recusadas',async()=>{
 const f=fixture(),body=f.body();await f.control.update({actor:'master',body});f.state.used=12;const r=await f.control.update({actor:'master',body});assert.equal(r.config.totalLimit,57);assert.equal(r.remaining,45);assert.equal((await f.store.list('facial_config_audit')).length,1);
 await assert.rejects(f.control.update({actor:'master',body:{...body,remainingLimit:60}}),{code:'FACIAL_CONFIG_REUTILIZADA'});await assert.rejects(f.control.update({actor:'master',body:f.body()}),{code:'REGISTRO_ALTERADO'});
});
test('validade e quantidades são limitadas; duas alterações concorrentes não se sobrepõem',async()=>{
 const f=fixture();for(const change of [{remainingLimit:0},{remainingLimit:10001},{dailyLimit:0},{dailyLimit:1001},{endAt:'2026-10-01'},{endAt:'2099-01-01'}])await assert.rejects(f.control.update({actor:'master',body:f.body(change)}));
 const results=await Promise.allSettled([f.control.update({actor:'a',body:f.body()}),f.control.update({actor:'b',body:f.body()})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.store.list('facial_config_audit')).length,1);
});
