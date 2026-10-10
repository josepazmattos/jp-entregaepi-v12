const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const cleanCnpj = value => String(value || '').toUpperCase().replace(/[.\/\-\s]/g, '');
export function validCnpj(value) {
  const cnpj = cleanCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = base => {
    let weight = base.length - 7;
    const sum = [...base].reduce((total, char) => { const result = total + (char.charCodeAt(0) - 48) * weight; weight = weight === 2 ? 9 : weight - 1; return result; }, 0);
    return String(sum % 11 < 2 ? 0 : 11 - sum % 11);
  };
  const first = digit(cnpj.slice(0, 12));
  return cnpj.slice(-2) === first + digit(cnpj.slice(0, 12) + first);
}
const labels = { nome: ['NOME EMPRESARIAL', 'RAZAO SOCIAL'], cnpj: ['NUMERO DE INSCRICAO', 'CNPJ'], cidade: ['MUNICIPIO', 'CIDADE', 'LOCALIDADE'], uf: ['UF', 'ESTADO'] };
const isLabel = (text, options) => options.some(label => fold(text).replace(/:.*$/, '') === label);
export function extractCompany(pages) {
  const fields = {}, texts = [];
  for (const items of pages) {
    const cells = items.filter(item => item.str?.trim()).map(item => ({ text: item.str.trim(), x: item.transform?.[4] ?? item.x, y: item.transform?.[5] ?? item.y }));
    texts.push(cells.map(cell => cell.text).join('\n'));
    for (const [key, options] of Object.entries(labels)) {
      if (fields[key]) continue;
      const head = cells.find(cell => isLabel(cell.text, options));
      if (!head) continue;
      const colon = head.text.indexOf(':');
      if (colon >= 0 && head.text.slice(colon + 1).trim()) { fields[key] = head.text.slice(colon + 1).trim(); continue; }
      const next = cells.filter(cell => Math.abs(cell.y - head.y) < 3 && cell.x > head.x + 20).sort((a, b) => a.x - b.x)[0];
      const below = cells.filter(cell => cell.y < head.y - 3 && cell.y > head.y - 65 && cell.x >= head.x - 3 && cell.x < (next ? next.x - 3 : Infinity));
      if (below.length) {
        const y = Math.max(...below.map(cell => cell.y));
        fields[key] = below.filter(cell => Math.abs(cell.y - y) < 3).sort((a, b) => a.x - b.x).map(cell => cell.text).join(' ');
      }
    }
  }
  const text = texts.join('\n'), warnings = [];
  const found = [...new Set((text.toUpperCase().match(/\b[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}\b/g) || []).map(cleanCnpj))];
  if (found.length > 1) return { fields: {}, warnings: ['O PDF contém mais de um CNPJ. Envie um cartão por vez ou preencha manualmente.'] };
  const cnpj = found[0] || cleanCnpj(fields.cnpj);
  if (!validCnpj(cnpj)) warnings.push('Não foi identificado um CNPJ válido. Confira o cartão ou preencha manualmente.');
  const city = fold(fields.cidade), uf = fold(fields.uf);
  const locality = city && /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(uf) ? city + '/' + uf : '';
  const name = String(fields.nome || '').trim();
  if (!name) warnings.push('A razão social não foi identificada. Preencha o nome manualmente.');
  if (!locality) warnings.push('Município/UF não identificados. Confira a localidade.');
  if (text.replace(/\s/g, '').length < 35) warnings.push('Este PDF não contém texto legível. Use um PDF pesquisável ou o cadastro manual.');
  return { fields: { nome: name, cnpj: validCnpj(cnpj) ? cnpj.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5') : '', localidade: locality }, warnings };
}

export async function readCompanyPdf(file, { signal } = {}) {
  if (file.size > 10 * 1024 * 1024) throw Error('Envie um cartão CNPJ em PDF de até 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw Error('Selecione um arquivo PDF válido.');
  signal?.throwIfAborted();
  const pdfjs = await import('./vendor/pdfjs-5.6.205/pdf.min.mjs');
  signal?.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs-5.6.205/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: true, useWorkerFetch: false, disableFontFace: true });
  const abort = () => { task.destroy().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const doc = await task.promise;
    if (doc.numPages > 15) throw Error('Envie um cartão CNPJ com até 15 páginas.');
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) { signal?.throwIfAborted(); pages.push((await (await doc.getPage(i)).getTextContent()).items); }
    return extractCompany(pages);
  } catch (error) {
    if (error.name === 'PasswordException') throw Error('PDF protegido por senha. Envie uma cópia desbloqueada.');
    if (/worker|fetch|module/i.test(error.message)) throw Error('Não foi possível carregar o leitor de PDF. Tente novamente ou preencha manualmente.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); await task.destroy(); }
}
