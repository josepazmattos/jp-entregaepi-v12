import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFileSync} from 'node:fs';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { documentContent, documentHash } from './document-integrity.js';
import { httpError } from '../middleware/auth.js';

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
  text('FICHA DE CONTROLE DE EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL', { size: 14, type: bold, center: true, gap: 12 });
  text(`Empresa: ${company.nome || ''}    ${company.inscricaoTipo==='CAEPF'?'CAEPF':'CNPJ'}: ${company.cnpj || ''}`, { type: bold });
  text(`Trabalhador: ${worker.nomeCompleto || ficha.trabalhadorNome}    CPF: ${worker.cpf || ''}`);
  text(`Função: ${worker.funcao || ''}    Matrícula eSocial: ${worker.matriculaESocial || ''}`);
  text(`Movimentação: ${ficha.tipo}    Data: ${ficha.data}    Ficha: ${ficha.numero || ficha.id}`, { size: 10, gap: 12 });
  text('TERMO DE RESPONSABILIDADE', { type: bold, size: 13, center: true, gap: 8 });
  text(ficha.modeloFicha?.termoResponsabilidade || '', { size: 11 });
  text(`${company.localidade || worker.localidade || ''}${company.uf ? '/' + company.uf : ''} — ${ficha.data}`, { type: bold, gap: 10 });
  const imageUrl = bio.realFingerImage;
  if (/^data:image\/(png|jpeg);base64,/.test(imageUrl || '')) {
    ensure(112); const bytes = Buffer.from(imageUrl.split(',')[1], 'base64');
    const img = imageUrl.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const dims = img.scale(Math.min(50 / img.width, 62 / img.height));
    page.drawImage(img, { x: (width - dims.width) / 2, y: y - dims.height, width: dims.width, height: dims.height }); y -= dims.height + 5;
  }
  text(worker.nomeCompleto || ficha.trabalhadorNome, { center: true, type: bold });
  text(`Biometria confirmada em ${bio.signedAt} · ${bio.dedo}`, { center: true, size: 8, gap: 12 });
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
  for (const item of ficha.itens) row([item.quantidade, item.epiNome || item.epiDescricao, item.semCA ? 'Sem CA' : item.ca, item.datasMovimentacao?.entrega || '', item.datasMovimentacao?.devolucao || '', 'Biometria confirmada']);
  y -= 12;
  text(`Certificação digital: ${certificate.subject}\nIdentificador da confirmação biométrica: ${bio.id}\nConteúdo confirmado (SHA-256): ${documentHash(ficha)}`, { size: 8 });
  if(certificate.kind==='e-CPF'){const rep=certificate.target?.representative;text(`Assinante e-CPF: ${certificate.cpf} · Vínculo: ${rep?.capacity||''}\nRepresentação conferida em ${rep?.checkedAt||''}; revisão até ${rep?.validUntil||''}.`,{size:8});}
  text('Preserve este arquivo original. Uma impressão em papel ou uma nova impressão em PDF não preserva a assinatura digital incorporada.', { size: 8 });
  const evidence = { schema: 'JPGED-1', representation: certificate.kind==='e-CPF'?certificate.target?.representative:null, document: documentContent(ficha), documentHash: documentHash(ficha), biometric: { id: bio.id, signedAt: bio.signedAt, finger: bio.dedo, proof: bio.proof, proofSignature: bio.proofSignature, publicKey: bio.publicKey } };
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
