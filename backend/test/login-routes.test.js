import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import serverlessHttp from 'serverless-http';
import {createLoginRouter} from '../src/routes/login.routes.js';

test('resolver público usa o login atual, recusa alias antigo/excluído e não expõe dados da empresa',async()=>{
  const company={login:'ivr',cognitoUsername:'11222333000181',nome:'EMPRESA',email:'privado@example.invalid',cognitoSub:'PRIVATE',_passwordReset:{status:'concluida'}};
  const app=express();app.use(express.json());app.use('/auth',createLoginRouter({getCompanyByLogin:async login=>['ivr','11222333000181'].includes(login)?company:login==='excluida'?{login,excluidaEm:'2026-10-10'}:null}));app.use((error,req,res,next)=>res.status(error.status||500).json({ok:false,code:error.code}));
  const handler=serverlessHttp(app);
  async function resolve(login){const r=await handler({version:'2.0',rawPath:'/auth/resolver',rawQueryString:'',headers:{host:'test.invalid','content-type':'application/json'},requestContext:{http:{method:'POST',path:'/auth/resolver',sourceIp:'127.0.0.1',protocol:'HTTP/1.1'}},body:JSON.stringify({login})},{});return{status:r.statusCode,body:JSON.parse(r.body)};}
  assert.deepEqual(await resolve('IVR'),{status:200,body:{ok:true,username:'11222333000181'}});
  assert.equal((await resolve('11222333000181')).status,400);assert.equal((await resolve('excluida')).status,400);
  assert.deepEqual(await resolve('MASTER'),{status:200,body:{ok:true,username:'master'}});
  assert.equal((await resolve('')).status,400);assert.equal((await resolve({foo:'bar'})).status,400);
});
