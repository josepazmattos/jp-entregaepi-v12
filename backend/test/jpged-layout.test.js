import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {buildSigningPdf} from '../src/services/jpged-pdf.js';
import {documentHash} from '../src/services/document-integrity.js';
import {MODELO_FICHA_APROVADO} from '../src/services/ficha-modelo.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const ficha={id:'synthetic-layout',numero:'DEMONSTRACAO-SEM-VALIDADE',empresaId:'synthetic',trabalhadorId:'worker',trabalhadorNome:'COLABORADOR SINTÉTICO PARA DEMONSTRAÇÃO',empresaSnapshot:{nome:'EMPRESA SINTÉTICA DE DEMONSTRAÇÃO DO NOVO FORMATO',cnpj:'00000000000000',localidade:'DOURADOS',uf:'MS',logoDataUrl:image},trabalhadorSnapshot:{nomeCompleto:'COLABORADOR SINTÉTICO PARA DEMONSTRAÇÃO',cpf:'00000000000',funcao:'Técnico de Segurança do Trabalho',matriculaESocial:'01020304'},modeloFicha:MODELO_FICHA_APROVADO,tipo:'Entrega e Devolução',data:'10/10/2026',itens:[{quantidade:1,epiNome:'Capacete de Segurança',ca:'365',datasMovimentacao:{devolucao:'10/10/2026'}},{quantidade:1,epiNome:'Capacete de Segurança',ca:'365',datasMovimentacao:{entrega:'10/10/2026'}}],assinaturaBiometrica:{id:'00000000-0000-4000-8000-000000000001',signedAt:'2026-10-11T03:30:29.500Z',dedo:'L_THUMB',realFingerImage:image,proof:'SYNTHETIC',proofSignature:'SYNTHETIC',publicKey:'SYNTHETIC'}};
const cert={kind:'e-CPF',cpf:'00000000000',subject:'C=BR\nO=ICP-Brasil\nOU=Secretaria da Receita Federal do Brasil - RFB\nOU=RFB e-CPF A1\nOU=(EM BRANCO)\nOU=00000000000000\nOU=videoconferencia\nCN=SIGNATÁRIO SINTÉTICO PARA DEMONSTRAÇÃO:00000000000'};
async function inspect(record=ficha,certificate=cert){
 const built=await buildSigningPdf(record,certificate),doc=await PDFDocument.load(built.pdf),dir=mkdtempSync(join(tmpdir(),'jpged-layout-'));
 try{const file=join(dir,'sample.pdf');writeFileSync(file,built.pdf);const text=execFileSync('pdftotext',['-layout',file,'-']).toString();return {built,doc,text};}finally{rmSync(dir,{recursive:true,force:true});}
}
test('modelo com logo, termo integral, entrega/devolução e autenticação cabe em uma página',async()=>{
 const {built,doc,text}=await inspect();assert.equal(doc.getPageCount(),1);assert.match(text,/AUTENTICAÇÃO DA FICHA/);assert.match(text,/SIGNATÁRIO SINTÉTICO/);assert.ok(text.includes(documentHash(ficha)));assert.match(text,/guarda e conservação/);assert.match(text,/art\. 462/);assert.match(text,/anteriormente à entrega/);assert.match(text,/Página 1\/1/);assert.equal(text.includes('OU=videoconferencia'),false);assert.equal(text.includes('CPF do assinante'),false);
 // Full certificate identity remains inside the signed PDF, not merely a caption.
 const signature=doc.context.enumerateIndirectObjects().map(([,value])=>value).find(value=>value?.get?.(PDFName.of('Type'))?.toString()==='/Sig');assert.equal(signature.get(PDFName.of('Name')).decodeText(),cert.subject);
 const evidence=doc.context.enumerateIndirectObjects().map(([,value])=>value).filter(value=>value instanceof PDFRawStream).map(value=>{try{return JSON.parse(Buffer.from(decodePDFRawStream(value).decode()).toString());}catch{return null;}}).find(value=>value?.schema==='JPGED-1');assert.equal(evidence.documentHash,documentHash(ficha));assert.deepEqual(evidence.document.itens,ficha.itens);assert.equal(evidence.biometric.id,ficha.assinaturaBiometrica.id);
 if(process.env.JPGED_LAYOUT_OUTPUT){mkdirSync(process.env.JPGED_LAYOUT_OUTPUT,{recursive:true});writeFileSync(join(process.env.JPGED_LAYOUT_OUTPUT,'ficha-compacta-sintetica.pdf'),built.pdf);}
});
test('muitos EPIs preservam texto e paginação; autenticação não fica dividida',async()=>{
 const record={...ficha,itens:Array.from({length:65},(_,i)=>({quantidade:i+1,epiNome:'EQUIPAMENTO DE DEMONSTRAÇÃO '+i,semCA:i%2===0,ca:'365',datasMovimentacao:i%2?{entrega:'10/10/2026'}:{devolucao:'10/10/2026'}}))};
 const {doc,text}=await inspect(record);assert.ok(doc.getPageCount()>1);assert.match(text,/DEMONSTRAÇÃO 64/);assert.match(text,/Sem CA/);
 const pages=text.split('\f').filter(p=>p.trim()),authentication=pages.filter(p=>p.includes('AUTENTICAÇÃO DA FICHA'));assert.equal(authentication.length,1);assert.ok(authentication[0].includes(documentHash(record)));assert.match(authentication[0],/Preserve o arquivo/);
});
test('nome extenso do signatário quebra linhas sem perder a identidade',async()=>{
 const long={...cert,subject:'CN='+('NOME SINTÉTICO EXTENSO '.repeat(12)).trim()+':00000000000'};
 const {text}=await inspect(ficha,long);assert.equal((text.replace(/\s+/g,' ').match(/NOME SINTÉTICO EXTENSO/g)||[]).length,12);assert.ok(text.includes(documentHash(ficha)));
});
test('termo das duas capturas e confirmação facial ficam no PDF sem fotografia de rosto',async()=>{
 const record={...ficha,assinaturaBiometrica:{...ficha.assinaturaBiometrica,metodo:'AWS_REKOGNITION_FACE_LIVENESS',dedo:undefined,realFingerImage:undefined,keyArn:'synthetic-key',aceiteTermo:{confirmado:true,metodo:'FACIAL'}}};
 const {built,doc,text}=await inspect(record);assert.equal(doc.getPageCount(),1);assert.match(text.replace(/\s+/g,' '),/captura biométrica realizada por mim, digital ou facial/);assert.match(text,/BIOMÉTRICA FACIAL VERIFICADA/);assert.doesNotMatch(text,/undefined|L_THUMB/);assert.match(text,/Biometria facial/);
 if(process.env.JPGED_LAYOUT_OUTPUT)writeFileSync(join(process.env.JPGED_LAYOUT_OUTPUT,'ficha-facial-sintetica.pdf'),built.pdf);
});
