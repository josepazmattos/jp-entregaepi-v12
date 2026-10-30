// Synthetic print-layout checks; no application API, reader or real personal data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require('playwright');
const output=path.join(__dirname,'output/biometric-records');fs.mkdirSync(output,{recursive:true});
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/EntregaEPI/assets/biometric-records.js'),'utf8'),context);
const print=context.window.JP_BIOMETRIC_RECORDS;
const data={emitidoEm:'2026-10-30T16:00:00Z',empresa:{id:'EMPRESA-SINTETICA',nome:'EMPRESA SINTÉTICA PARA TESTE',cnpj:'00.000.000/0000-00',localidade:'Dourados',uf:'MS'},trabalhador:{id:'PESSOA-SINTETICA',nome:'TRABALHADOR SINTÉTICO SEM VALIDADE DOCUMENTAL',cpf:'000.000.000-00',matriculaESocial:'00001A',funcao:'FUNÇÃO SINTÉTICA',status:'Ativo'}};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{}),args:['--no-sandbox',...(process.env.JP_TEST_SINGLE_PROCESS==='1'?['--single-process','--no-zygote']:[])]});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}});await page.setContent('<html></html>');
  const sample=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,100,100);x.fillStyle='#456';x.font='bold 12px Arial';x.fillText('AMOSTRA',18,48);x.fillText('SINTÉTICA',14,65);return c.toDataURL();});
  const fingers=['R_THUMB','R_INDEX','R_MIDDLE','R_RING','R_LITTLE','L_THUMB','L_INDEX','L_MIDDLE','L_RING','L_LITTLE'];
  data.digitais=fingers.map(fingerCode=>({fingerCode,enrolledAt:'2026-09-01T13:00:00Z',imageDataUrl:sample,template:'SECRET_TEMPLATE',publicKey:'SECRET_KEY'}));
  const html=print.buildEnrollment(data);assert.ok(!html.includes('SECRET_TEMPLATE')&&!html.includes('SECRET_KEY'));
  await page.setContent(html);await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('.finger').count(),10);
  const pdf=await page.pdf({path:path.join(output,'dez-digitais.pdf'),preferCSSPageSize:true,printBackground:true});assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1);
  const empty=print.buildEnrollment({...data,digitais:[]});assert.ok(empty.includes('Nenhuma digital cadastrada.'));assert.ok(!empty.includes('01/09/2026'));
  const malicious=print.buildEnrollment({...data,empresa:{...data.empresa,nome:'<script>window.injected=true</script>',logoDataUrl:'https://example.invalid/image.png'},digitais:[{fingerCode:'R_INDEX',imageDataUrl:'javascript:alert(1)',enrolledAt:'invalid'}]});
  await page.setContent(malicious);assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.locator('img').count(),0);assert.match(await page.locator('.finger').innerText(),/Não registrada/);
  const trabalhadores=Array.from({length:45},(_,i)=>({...data.trabalhador,nome:'TRABALHADOR SINTÉTICO '+String(i+1).padStart(2,'0'),fingers:i%2?data.digitais.map(({fingerCode,enrolledAt})=>({fingerCode,enrolledAt})):[]}));
  await page.setContent(print.buildReport({...data,trabalhadores}));assert.equal(await page.locator('tbody tr').count(),45);assert.equal(await page.locator('img').count(),0);
  const report=await page.pdf({path:path.join(output,'relatorio-45-trabalhadores.pdf'),preferCSSPageSize:true,printBackground:true});assert.ok((report.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length>1);
  console.log('PASSOU: dez digitais em A4; relatório paginado; cadastro vazio; escape HTML; nenhuma imagem externa ou template.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
