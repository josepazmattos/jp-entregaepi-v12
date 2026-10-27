const {chromium}=require('playwright');const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../frontend/EntregaEPI'),output=path.join(__dirname,'output/security');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,new URL(req.url,'http://local').pathname.replace(/^\/EntregaEPI\/?/,'')||'index.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file).toString().replaceAll('__APP_PREFIX__','EntregaEPI'));});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.JP_TEST_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[],calls=[];let enrolled=true,verified=false,wrong=false,challengeCount=0;
 const claims={sub:'synthetic-master','cognito:groups':['MASTER'],auth_time:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic';
 await context.addInitScript(()=>Object.defineProperty(navigator.permissions,'query',{value:async()=>({state:'denied'})}));
 await context.route(u=>u.origin!==origin,async route=>{const req=route.request(),u=new URL(req.url()),json=(b,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(b)});calls.push(u.pathname);
 if(u.pathname==='/auth/resolver')return json({ok:true,username:'synthetic-master'});
 if(u.hostname.startsWith('cognito-idp.')){const op=req.headers()['x-amz-target']?.split('.').pop();assert.equal(op,'InitiateAuth');challengeCount++;return json({ChallengeName:'EMAIL_OTP',Session:'synthetic-challenge-session-'+challengeCount,ChallengeParameters:{USERNAME:'synthetic-master',CODE_DELIVERY_DESTINATION:'d***@example.test'}});}
 if(u.pathname==='/auth/mfa'){const data=req.postDataJSON();assert.equal(data.session,'synthetic-challenge-session-'+challengeCount);assert.equal(data.challengeName,'EMAIL_OTP');if(data.code==='000000'){wrong=true;return json({ok:false,error:'Código inválido.'},401);}assert.equal(data.code,'123456');verified=true;return json({ok:true,AuthenticationResult:{IdToken:token,AccessToken:'synthetic-access',ExpiresIn:3600}});}
 if(u.pathname==='/api/seguranca/status')return json({ok:true,required:true,enrolled,verified});
 if(u.pathname==='/health')return json({ok:true,durable:true,storageReady:true});if(u.pathname.startsWith('/api/caepi'))return json({ok:true,item:{found:true}});
 if(u.pathname.startsWith('/api/')){assert.equal(verified,true,'Master must not load data before MFA');if(u.pathname==='/api/jpged/certificado')return json({ok:true,certificate:null});return json({ok:true,items:[]});}
 return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/EntregaEPI/');
 const login=async()=>{await page.locator('#username').fill('synthetic-master');await page.locator('#password').fill('synthetic');await page.locator('#loginButton').click();};
 await login();await page.locator('#mfaCode').waitFor();assert.equal(await page.locator('#appShell').isVisible(),false);assert.equal(calls.includes('/api/empresas'),false);assert.equal(await page.locator('#mfaSetupCode').count(),0);assert.match(await page.locator('.jp-dialog').textContent(),/d\*\*\*@example.test/);
 await page.locator('.dialog-close').click();await page.waitForFunction(()=>!document.querySelector('.jp-dialog'));await login();await page.locator('#mfaCode').waitFor();assert.equal(challengeCount,2);
 await page.locator('#mfaCode').fill('000000');await page.locator('.jp-dialog button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('.dialog-message')?.textContent.includes('inválido'));assert.equal(wrong,true);assert.equal(await page.locator('#appShell').isVisible(),false);
 await page.setViewportSize({width:390,height:844});await page.locator('#mfaCode').fill('123 456');assert.equal(await page.locator('#mfaCode').inputValue(),'123456');await page.screenshot({path:path.join(output,'mfa-email-mobile.png')});await page.locator('.jp-dialog button[type=submit]').click();await page.waitForSelector('#appShell:not(.hidden)');assert.equal(verified,true);assert.deepEqual(errors,[]);
 // The same confirmation function is used for certificate reauthentication.
 verified=false;await page.evaluate(()=>{window.reauthPromise=finishMfaChallenge({ChallengeName:'EMAIL_OTP',Session:'synthetic-challenge-session-2',ChallengeParameters:{USERNAME:'synthetic-master',CODE_DELIVERY_DESTINATION:'d***@example.test'}},'synthetic-master');});await page.locator('#mfaCode').fill('123456');await page.locator('.jp-dialog button[type=submit]').click();assert.ok(await page.evaluate(async()=>Boolean((await window.reauthPromise).AuthenticationResult.IdToken)));
 // A password-only session must still be rejected, including an unconfigured Master.
 enrolled=false;verified=false;assert.equal(await page.evaluate(()=>allowMasterSession()),false);assert.equal(await page.locator('#appShell').isVisible(),false);assert.match(await page.locator('#loginMessage').textContent(),/administrador/);
 console.log('PASS: Email MFA login, retry, invalid code, paste, protected data, mobile, certificate reauthentication and unconfigured Master denial.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
