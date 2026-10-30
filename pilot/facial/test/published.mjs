import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {chromium}=await import(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'));
const base='https://www.jptreinamentos.com.br/EntregaEPI/teste-facial/';
const api='https://4bnxgzk3f2.execute-api.sa-east-1.amazonaws.com';
await mkdir('out',{recursive:true});
const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
const proxy=proxyUrl?new URL(proxyUrl):null;
const browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell',headless:true,args:['--no-sandbox','--single-process'],...(proxy?{proxy:{server:proxy.origin,...(proxy.username?{username:decodeURIComponent(proxy.username),password:decodeURIComponent(proxy.password)}:{})}}:{})});
try {
  // The development proxy CA is absent from Chromium's trust store. This check
  // verifies content and application behavior; it is not a TLS certificate audit.
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,ignoreHTTPSErrors:Boolean(proxy)});
  const page=await context.newPage(),errors=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'index.html',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Acesso Master'}).waitFor();
  assert.equal(await page.evaluate(()=>window.JP_FACIAL_CONFIG.apiUrl),api);
  checks.push('Página publicada exige login e aponta para API isolada');
  for(const name of ['index.html','config.js','app.js','app.css','app.js.LEGAL.txt']){
    const response=await context.request.get(base+name);
    assert.equal(response.status(),200);
    const hash=value=>createHash('sha256').update(value).digest('hex');
    assert.equal(hash(await response.body()),hash(await readFile('dist/web/'+name)));
  }
  checks.push('Cinco arquivos publicados iguais ao pacote local');
  for(const [width,height]of [[320,740],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  checks.push('Página publicada cabe em seis tamanhos');
  const statuses=await page.evaluate(async api=>{
    const health=await fetch(api+'/health');
    const records=await fetch(api+'/records');
    const invalid=await fetch(api+'/records',{headers:{Authorization:'Bearer invalid.synthetic.token'}});
    return {health:health.status,records:records.status,invalid:invalid.status};
  },api);
  assert.deepEqual(statuses,{health:200,records:401,invalid:401});
  checks.push('API saudável, CORS funcional e acesso sem token válido recusado');
  assert.equal(errors.length,0);
  checks.push('Nenhum erro JavaScript na tela de acesso');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'out/published-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'out/published-desktop.png',fullPage:true});
  const result={passed:true,checks,statuses,faceCaptured:false,masterLoginTested:false,tlsAudited:false,at:new Date().toISOString()};
  await writeFile('out/published-results.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser.close();}
