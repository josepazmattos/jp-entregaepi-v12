// Controlled latency comparison. This is not a measurement of a physical reader.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const bio=require('../frontend/EntregaEPI/assets/biometria.js');
const ready={ok:true,service:'JP Biometria',version:'12.10.1',sdk:true,reader:true,deviceCount:1,capabilities:{capture:true,captureMethod:'POST',capturePath:'/api/capture'}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function measure(reuseRecent){
  let statusRequests=0,captureRequests=0;
  const client=bio.createClient({fetch:async(url,init)=>{
    assert.equal(new URL(url).port,'8789');
    if(init.method==='GET'){statusRequests++;await pause(150);return Response.json(ready);}
    captureRequests++;await pause(25);return Response.json({ok:true,realFingerImage:true,image:'SYNTHETIC-NOT-DISPLAYED'});
  }});
  await client.discover();statusRequests=0;
  const totalMs=[],preparationMs=[];
  for(let i=0;i<5;i++){
    const started=performance.now();await client.discover({reuseRecent});
    preparationMs.push(Math.round(performance.now()-started));
    await client.capture({fingerCode:'R_INDEX'});totalMs.push(Math.round(performance.now()-started));
  }
  return {statusRequests,captureRequests,preparationMs,totalMs};
}
(async()=>{
  const before=await measure(false),after=await measure(true);
  assert.equal(before.statusRequests,5);assert.equal(after.statusRequests,0);
  assert.equal(before.captureRequests,5);assert.equal(after.captureRequests,5);
  const report={synthetic:true,physicalReaderTested:false,simulatedStatusMs:150,simulatedCaptureMs:25,before,after};
  const output=path.join(__dirname,'output/biometria-latency.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
