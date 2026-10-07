// Synthetic regression: unrestricted alphanumeric enrollment remains complete in print.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
require('../frontend/EntregaEPI/assets/ficha.js');

const output = path.join(__dirname, 'output');
fs.mkdirSync(output, { recursive: true });
const matricula = '00Ab9Z'.repeat(600) + 'FINAL0';
const company = { nome: 'EMPRESA SINTÉTICA', cnpj: '00.000.000/0000-00', localidade: 'LOCALIDADE TESTE', uf: 'MT' };
const worker = { nomeCompleto: 'TRABALHADOR SINTÉTICO', cpf: '000.000.000-00', funcao: 'FUNÇÃO TESTE', matriculaESocial: matricula };
const record = { id: 'FICHA-SINTETICA-MATRICULA', ...globalThis.JP_FICHA.createSnapshot(company, worker), numero: 'FICHA-SINTETICA-MATRICULA', tipo: 'Entrega', data: '07/10/2026', status: 'pendente', itens: [{ epiDescricao: 'EQUIPAMENTO SEM CA TESTE', semCA: true, quantidade: 1 }] };
const report = { syntheticData: true, realApiUsed: false, matriculaLength: matricula.length, passed: false };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'pt-BR' });
    await page.route('**/*', route => route.abort());
    await page.setContent(globalThis.JP_FICHA.buildDocument(record, company, worker));
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.docx-meta td')].find(item => item.textContent.startsWith('Matrícula eSocial:'));
      const term = document.querySelector('.docx-term');
      const epi = document.querySelector('.docx-epi-table');
      return { matricula: cell.textContent.replace(/^Matrícula eSocial:\s*/, ''), overflow: cell.scrollWidth > cell.clientWidth + 1,
        metadataBottom: document.querySelector('.docx-meta').getBoundingClientRect().bottom, termTop: term.getBoundingClientRect().top,
        termBottom: term.getBoundingClientRect().bottom, epiTop: epi.getBoundingClientRect().top,
        termText: [...term.querySelectorAll('p')].slice(0, 2).map(p => p.textContent).join('\n\n'), ca: epi.querySelector('tbody tr td:nth-child(3)').textContent };
    });
    assert.equal(geometry.matricula, matricula, 'matrícula aparece integralmente, com letras e zeros');
    assert.equal(geometry.overflow, false, 'matrícula longa quebra dentro da célula');
    assert.ok(geometry.metadataBottom <= geometry.termTop, 'identificação permanece antes do termo');
    assert.ok(geometry.termBottom <= geometry.epiTop + 1, 'termo integral permanece antes dos equipamentos');
    assert.equal(geometry.termText, record.modeloFicha.termoResponsabilidade);
    assert.equal(geometry.ca, 'Sem CA');
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ path: path.join(output, 'ficha-matricula-longa.pdf'), format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    report.pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    assert.ok(report.pages > 1, 'matrícula longa continua nas páginas necessárias');
    await page.screenshot({ path: path.join(output, 'ficha-matricula-longa.png'), fullPage: true });
    report.passed = true;
    console.log(`PASSOU: matrícula eSocial alfanumérica de ${matricula.length} caracteres integral na ficha; PDF com ${report.pages} páginas.`);
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'ficha-matricula-results.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
