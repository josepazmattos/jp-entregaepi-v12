const {chromium} = require('../../../tests/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');

const root = path.resolve(__dirname,'..');
const extension = path.join(root,'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
const id = [...crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(n=>String.fromCharCode(97+parseInt(n,16))).join('');
const output = path.join(root,'test-output');fs.mkdirSync(output,{recursive:true});

(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jp-extension-test-'));
  const browser=await chromium.launchPersistentContext(profile,{
    ...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{channel:'chromium'}),
    headless:true,viewport:{width:1280,height:1000},
    args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  const passed=[];
  async function check(name,fn){await fn();passed.push(name);console.log('PASS',name)}
  try {
    let [worker]=browser.serviceWorkers();if(!worker)worker=await browser.waitForEvent('serviceworker');
    assert.equal(worker.url(),`chrome-extension://${id}/background.js`);
    const page=await browser.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(`chrome-extension://${id}/popup.html`);
    await check('extension loads with stable ID and capture disabled until verification',async()=>{
      assert.equal(await page.locator('#capture').isDisabled(),true);
      assert.equal(await page.locator('#status-title').innerText(),'Vamos verificar seu leitor');
    });
    await check('real extension diagnoses missing native host',async()=>{
      await page.locator('#verify').click();
      await page.locator('#status-title').filter({hasText:'Instale o conector JP'}).waitFor();
      assert.equal(await page.locator('#capture').isDisabled(),true);
    });
    await check('background rejects certificate command even from popup',async()=>{
      const result=await page.evaluate(()=>chrome.runtime.sendMessage({action:'certificate'}));assert.equal(result.code,'INVALID_REQUEST');
    });
    await check('help page cannot request capture',async()=>{
      const help=await browser.newPage();await help.goto(`chrome-extension://${id}/guide.html`);
      const r=await help.evaluate(()=>chrome.runtime.sendMessage({action:'captureTest',finger:'R_INDEX'}));assert.equal(r.code,'INVALID_REQUEST');await help.close();
    });
    await check('external website can neither capture nor access certificates',async()=>{
      await browser.route('https://www.jptreinamentos.com.br/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Test fixture</title><p>Isolated test fixture</p>'}));
      const website=await browser.newPage();await website.goto('https://www.jptreinamentos.com.br/EntregaEPI/');
      const status=await website.evaluate(id=>chrome.runtime.sendMessage(id,{action:'status'}),id);assert.equal(status.code,'CONNECTOR_MISSING');
      for(const action of ['captureTest','certificate']){
        const r=await website.evaluate(({id,action})=>chrome.runtime.sendMessage(id,{action,finger:'R_INDEX'}),{id,action});assert.equal(r.code,'INVALID_REQUEST');
      }
      await website.goto('https://www.jptreinamentos.com.br/adm/');
      const r=await website.evaluate(id=>chrome.runtime.sendMessage(id,{action:'status'}),id);assert.equal(r.code,'INVALID_REQUEST');await website.close();
    });
    await check('simulated statuses produce readable next steps; no false ready for SDK or busy',async()=>{
      for(const [code,title] of [['READY','Leitor pronto para teste'],['SDK_NOT_FOUND','Integração NITGEN ausente'],['READER_BUSY','Leitor em uso'],['AGENT_OFFLINE','Abra o JP Biometria'],['READER_NOT_READY','Leitor ainda não está pronto']]){
        await page.evaluate(code=>{chrome.runtime.sendMessage=async()=>({ok:code==='READY',code,agentVersion:'12.10.0-bio2'});},code);
        await page.locator('#verify').click();assert.equal(await page.locator('#status-title').innerText(),title);
        assert.equal(await page.locator('#capture').isDisabled(),code!=='READY');
        assert.ok((await page.locator('#next-step').innerText()).length>20);
      }
    });
    await check('simulated image appears only after an explicit test and clears completely',async()=>{
      await page.evaluate(()=>{chrome.runtime.sendMessage=async r=>{
        if(r.action==='status')return {code:'READY'};
        const c=document.createElement('canvas');c.width=64;c.height=80;
        c.getContext('2d').fillRect(0,0,64,80);
        return {code:'CAPTURE_OK',image:c.toDataURL('image/png'),width:64,height:80};
      }});
      await page.locator('#verify').click();await page.locator('#test-panel').evaluate(el=>el.open=true);
      await page.locator('#capture').click();assert.equal(await page.locator('#image-box').isVisible(),true);
      assert.match(await page.locator('#finger-image').getAttribute('src'),/^data:image\/png/);
      await page.locator('#clear').click();assert.equal(await page.locator('#image-box').isVisible(),false);assert.equal(await page.locator('#finger-image').getAttribute('src'),null);
      await page.locator('#test-panel').evaluate(el=>el.open=false);
    });
    await page.locator('#verify').click();await page.setViewportSize({width:380,height:630});
    await page.screenshot({path:path.join(output,'popup-ready.png'),fullPage:true});
    await check('standalone preview works offline and switches simulated errors',async()=>{
      await page.setViewportSize({width:1280,height:1000});await page.goto(pathToFileURL(path.join(root,'docs/modelo.html')).href);
      await page.selectOption('#scenario','SDK_NOT_FOUND');await page.locator('#verify').click();
      await page.locator('#status-title').filter({hasText:'Integração NITGEN ausente'}).waitFor();
      await page.selectOption('#scenario','READY');await page.locator('#verify').click();
      await page.locator('#status-title').filter({hasText:'Leitor pronto para teste'}).waitFor();
      await page.screenshot({path:path.join(output,'modelo-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(output,'modelo-mobile.png'),fullPage:true});
    });
    assert.deepEqual(pageErrors,[]);
    const report={testedAt:new Date().toISOString(),browser:browser.browser().version(),extensionID:id,passed,hardwareTested:false,windowsInstallerExecuted:false,notes:'Browser is Linux Chromium. Image/capture responses are synthetic fixtures; missing-host check uses the real extension runtime.'};
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {await browser.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1)});
