const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const frontend=path.resolve(__dirname,'../frontend/EntregaEPI'),output=path.join(__dirname,'output/capture');
fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
  const relative=new URL(req.url,'http://localhost').pathname.replace(/^\/EntregaEPI\/?/,'');
  const file=path.resolve(frontend,relative||'index.html');
  if(!file.startsWith(frontend+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  const data=fs.readFileSync(file);res.end(path.extname(file)==='.html'?data.toString().replaceAll('__APP_PREFIX__','EntregaEPI'):data);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.JP_TEST_CHROMIUM?{executablePath:process.env.JP_TEST_CHROMIUM}:{})});
  await require('./frontend-biometria-browser.cjs')({browser,origin:`http://127.0.0.1:${server.address().port}`,output});
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
