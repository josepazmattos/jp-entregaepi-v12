import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFileSync} from 'node:fs';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { documentContent, documentHash } from './document-integrity.js';
import { httpError } from '../middleware/auth.js';
import { equipmentCaLabel, equipmentPrintName } from './equipment-classification.js';

// Generated on the server from the saved record, never from a client-supplied PDF.
export async function buildSigningPdf(ficha, certificate) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(new URL('../data/fonts/DejaVuSerif.ttf',import.meta.url)),{subset:true}), bold = await doc.embedFont(readFileSync(new URL('../data/fonts/DejaVuSerif-Bold.ttf',import.meta.url)),{subset:true});
  const clean = value => [...String(value ?? '')].map(c => { if(c==='\n')return c; try { font.encodeText(c); return c; } catch { return '?'; } }).join('');
  const width = 595.28, height = 841.89, margin = 25, available = width - margin * 2;
  let page, y;
  const newPage = () => { page = doc.addPage([width, height]); y = height - margin; };
  const ensure = space => { if (y - space < 40) newPage(); };
  function lines(value, maxWidth, size, type = font) {
    const out = [];
    for (const paragraph of clean(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (type.widthOfTextAtSize(word, size) > maxWidth) {
          if (line) { out.push(line); line = ''; }
          for (const character of word) { if (type.widthOfTextAtSize(line + character, size) > maxWidth) { out.push(line); line = ''; } line += character; }
        } else if (line && type.widthOfTextAtSize(line + ' ' + word, size) > maxWidth) { out.push(line); line = word; }
        else line += (line ? ' ' : '') + word;
      }
      out.push(line);
    }
    return out;
  }
  function text(value, { size = 11, type = font, center = false, gap = 4 } = {}) {
    for (const line of lines(value, available, size, type)) { ensure(size * 1.35); page.drawText(line, { x: center ? (width - type.widthOfTextAtSize(line, size)) / 2 : margin, y: y - size, size, font: type }); y -= size * 1.35; }
    y -= gap;
  }
  newPage();
  const company = ficha.empresaSnapshot || {}, worker = ficha.trabalhadorSnapshot || {}, bio = ficha.assinaturaBiometrica || {};
  const logo = company.logoDataUrl;
  if (/^data:image\/(png|jpeg);base64,/.test(logo || '')) {
    const data = Buffer.from(logo.split(',')[1], 'base64');
    const image = logo.startsWith('data:image/png') ? await doc.embedPng(data) : await doc.embedJpg(data);
    const dims = image.scale(Math.min(80 / image.width, 48 / image.height));
    page.drawImage(image, { x: margin, y: y - 48, width: dims.width, height: dims.height });
    y -= 55;
  }
  text(ficha.modeloFicha?.titulo || 'FICHA DE CONTROLE DE EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL', { size: 14, type: bold, center: true, gap: 12 });
  text(`Empresa: ${company.nome || ''}    ${company.inscricaoTipo==='CAEPF'?'CAEPF':'CNPJ'}: ${company.cnpj || ''}`, { type: bold });
  text(`Trabalhador: ${worker.nomeCompleto || ficha.trabalhadorNome}    CPF: ${worker.cpf || ''}`);
  text(`Função: ${worker.funcao || ''}    Matrícula eSocial: ${worker.matriculaESocial || ''}`);
  text(`Movimentação: ${ficha.tipo}    Data: ${ficha.data}    Ficha: ${ficha.numero || ficha.id}`, { size: 10, gap: 12 });
  text('TERMO DE RESPONSABILIDADE', { type: bold, size: 13, center: true, gap: 8 });
  text(ficha.modeloFicha?.termoResponsabilidade || '', { size: 11 });
  if(ficha.modeloFicha?.termoAssinatura)text('Confirmação da assinatura eletrônica: '+ficha.modeloFicha.termoAssinatura,{size:9.5,gap:8});
  text(`${company.localidade || worker.localidade || ''}${company.uf ? '/' + company.uf : ''} — ${ficha.data}`, { type: bold, gap: 10 });
  const imageUrl = bio.realFingerImage;
  const facial=bio.metodo==='AWS_REKOGNITION_FACE_LIVENESS';
  if(facial)text('ASSINATURA BIOMÉTRICA FACIAL VERIFICADA',{center:true,type:bold,size:10});
  if (/^data:image\/(png|jpeg);base64,/.test(imageUrl || '')) {
    ensure(112); const bytes = Buffer.from(imageUrl.split(',')[1], 'base64');
    const img = imageUrl.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const dims = img.scale(Math.min(50 / img.width, 62 / img.height));
    page.drawImage(img, { x: (width - dims.width) / 2, y: y - dims.height, width: dims.width, height: dims.height }); y -= dims.height + 5;
  }
  text(worker.nomeCompleto || ficha.trabalhadorNome, { center: true, type: bold });
  text(`Biometria confirmada em ${bio.signedAt} · ${facial?'Facial':bio.dedo}`, { center: true, size: 8, gap: 12 });
  const cols = [30, 179, 67, 64, 64, available - 404];
  function row(values, heading = false) {
    const all = values.map((value, i) => lines(value, cols[i] - 8, 9, heading ? bold : font));
    const rowHeight = Math.max(...all.map(x => x.length)) * 12 + 10;
    if (rowHeight > height - 100) throw httpError(422, 'Descrição extensa demais para a ficha certificada.', 'JPGED_LAYOUT');
    if (y - rowHeight < 45) { newPage(); if (!heading) tableHeader(); }
    let x = margin;
    all.forEach((part, i) => { page.drawRectangle({ x, y: y - rowHeight, width: cols[i], height: rowHeight, borderWidth: 0.5, borderColor: rgb(.25,.3,.28) }); part.forEach((line, n) => page.drawText(line, { x: x + 4, y: y - 13 - n * 12, size: 9, font: heading ? bold : font })); x += cols[i]; });
    y -= rowHeight;
  }
  function tableHeader() { row(['Qtd.','Equipamento','CA','Entrega','Devolução','Confirmação'], true); }
  tableHeader();
  for (const item of ficha.itens) row([item.quantidade, equipmentPrintName(item), equipmentCaLabel(item), item.datasMovimentacao?.entrega || '', item.datasMovimentacao?.devolucao || '', facial?'Biometria facial':'Biometria confirmada']);
  y -= 12;
  // Only the printed appearance is abbreviated. Full subject remains in the
  // PDF signature dictionary/CMS; complete evidence is still embedded below.
  const subject=String(certificate.subject||''),commonName=subject.match(/(?:^|\n)CN=([^\n]+)/)?.[1];
  const signer=(commonName||(!subject.includes('=')?subject:'Titular identificado no certificado')).replace(/:\d{11,14}$/,'');
  const authentication=[
    {value:'AUTENTICAÇÃO DA FICHA',size:8.5,type:bold},
    {value:`Certificação digital: ${signer} · ${certificate.kind||'A1'}`,size:8,type:font},
    {value:`Confirmação biométrica: ${bio.id}`,size:7.5,type:font},
    {value:`SHA-256 do conteúdo: ${documentHash(ficha)}`,size:7.5,type:font},
    {value:'A assinatura digital está no PDF original. Preserve o arquivo baixado do JPGED.',size:7.5,type:font}
  ].flatMap(item=>lines(item.value,available-16,item.size,item.type).map(value=>({...item,value})));
  const authenticationHeight=16+authentication.reduce((sum,item)=>sum+item.size*1.35,0);
  ensure(authenticationHeight);
  page.drawRectangle({x:margin,y:y-authenticationHeight,width:available,height:authenticationHeight,color:rgb(.97,.98,.97),borderWidth:.5,borderColor:rgb(.65,.72,.68)});
  let authenticationY=y-8;
  for(const item of authentication){page.drawText(item.value,{x:margin+8,y:authenticationY-item.size,size:item.size,font:item.type});authenticationY-=item.size*1.35;}
  y-=authenticationHeight;
  const evidence = { schema: 'JPGED-1', document: documentContent(ficha), documentHash: documentHash(ficha), biometric: { id: bio.id, signedAt: bio.signedAt, finger: bio.dedo, proof: bio.proof, proofSignature: bio.proofSignature, publicKey: bio.publicKey } };
  if(facial)Object.assign(evidence.biometric,{method:bio.metodo,keyArn:bio.keyArn,acceptance:bio.aceiteTermo});
  await doc.attach(Buffer.from(JSON.stringify(evidence)), 'evidencias-jpged.json', { mimeType: 'application/json', description: 'Conteúdo confirmado e prova biométrica. Sem template biométrico.' });
  doc.getPages().forEach((p, i, pages) => p.drawText(`JPGED · ${ficha.numero || ficha.id} · Página ${i+1}/${pages.length}`, { x: margin, y: 20, size: 8, font }));
  pdflibAddPlaceholder({ pdfDoc: doc, reason: 'Registro das movimentações de EPI confirmadas biometricamente', contactInfo: '', name: clean(certificate.subject), location: clean(company.localidade || ''), signatureLength: 65536, subFilter: 'ETSI.CAdES.detached', appName: 'JPGED' });
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  const source = pdf.toString('latin1'), range = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/.exec(source);
  if (!range) throw new Error('PDF_PLACEHOLDER_INVALID');
  const marker = pdf.indexOf('/Contents ', range.index), start = pdf.indexOf('<', marker), end = pdf.indexOf('>', start) + 1;
  if (marker < 0 || start < 0 || end <= start || pdf.length > 2 * 1024 * 1024) throw httpError(413, 'A ficha excede o limite do documento certificado.', 'JPGED_PDF_LIMIT');
  const value = `/ByteRange [0 ${start} ${end} ${pdf.length - end}]`;
  if (value.length > range[0].length) throw new Error('PDF_RANGE_INVALID');
  pdf.write(value.padEnd(range[0].length, ' '), range.index, 'ascii');
  return { pdf, start, end, signedBytes: Buffer.concat([pdf.subarray(0, start), pdf.subarray(end)]) };
}
export function signingBytes(pdf, start, end) { return Buffer.concat([pdf.subarray(0, start), pdf.subarray(end)]); }
export function embedCms(pdf, start, end, cms) {
  if (cms.length * 2 > end - start - 2) throw httpError(413, 'A assinatura excede o espaço disponível no PDF.', 'JPGED_CMS_LIMIT');
  const out = Buffer.from(pdf); out.write(cms.toString('hex').padEnd(end-start-2, '0'), start+1, 'ascii'); return out;
}
