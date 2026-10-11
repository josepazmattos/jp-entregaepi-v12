import test from 'node:test';
import assert from 'node:assert/strict';
import {documentFilename,attachmentDisposition} from '../src/services/document-filename.js';
import {createGedService} from '../src/services/jpged.service.js';
test('nome do PDF mantém data da ficha, espaços e acentos e cabe no Windows',()=>{
 const name=documentFilename({data:'10/10/2026',trabalhadorNome:'José Antônio de Mattos'});
 assert.equal(name,'Ficha-EPI-10-10-2026 - José Antônio de Mattos.pdf');
 assert.equal(documentFilename({data:'2026-10-10T23:00:00Z',trabalhadorNome:'José Antônio de Mattos'}),name);
 const header=attachmentDisposition(name);assert.match(header,/filename="Ficha-EPI-10-10-2026 - Jose Antonio de Mattos.pdf"/);assert.equal(decodeURIComponent(header.split("UTF-8''")[1]),name);
 for(const source of ['../\\A\r\nContent-Type:text/html',' \u202e?:*<>|','Á'.repeat(300)]){const file=documentFilename({data:'10/10/2026',trabalhadorNome:source});assert.ok(Buffer.byteLength(file)<240);assert.doesNotMatch(file,/[\r\n\u202e<>:"/\\|?*]/);assert.doesNotMatch(attachmentDisposition(file),/[\r\n]/);}
});
test('ficha antiga recebe novo nome de download sem alterar bytes, chave ou hash do original',async()=>{
 const record={path:'documents/company/original.pdf',data:'10/10/2026',trabalhadorNome:'Trabalhador Antigo',pdfHash:'original-hash'};let sent;
 const ged={get:async(c,t)=>c==='company'&&t==='DOC'?structuredClone(record):null,put:async(c,t)=>assert.equal(t,'AUDIT'),download:async(...args)=>{sent=args;return 'https://example.invalid/original';}};
 const service=createGedService({ged,store:{}}),out=await service.download('company','actor','doc');
 assert.deepEqual(sent,[record.path,'Ficha-EPI-10-10-2026 - Trabalhador Antigo.pdf']);assert.equal(out.sha256,record.pdfHash);assert.equal(out.filename,sent[1]);
 await assert.rejects(service.download('other','actor','doc'),{code:'JPGED_DOCUMENTO'});
});
