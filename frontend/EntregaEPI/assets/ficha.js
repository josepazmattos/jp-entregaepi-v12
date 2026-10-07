(function (root) {
  "use strict";

  // Texto e diagramação do modelo DOCX JP aprovado. Não abreviar o termo.
  const TERMO_APROVADO = "Declaro sob minha inteira responsabilidade a guarda e conservação dos equipamentos de proteção individual constantes nesta ficha-controle. Assumo também a responsabilidade de os devolver integralmente ou parcialmente, quando solicitado, ou por ocasião de eventual rescisão de contrato, na data do respectivo aviso de qualquer das partes.\n\nTambém estou ciente que, na eventualidade de danificar ou extraviar o equipamento por ato doloso ou culposo, estarei sujeito ao desconto do valor em meu salário, conforme parágrafo único do art. 158 da CLT. Também me comprometo a utilizá-los de forma correta e de acordo com as instruções de treinamento referentes ao uso correto, guarda conservação e higienização dos EPI, recebidas na presente data, fornecidas por profissional Técnico de Segurança do Trabalho. Também estou ciente que a não utilização dos mesmos em minhas atividades profissionais, é ato faltoso e passível de punições legais e disciplinares de acordo com a Consolidação das leis do Trabalho (CLT) – Capítulo V – Seção I – Art. 158o. c/c Norma Regulamentadora (NR) - NR-1 e NR-6, alínea 6.7, disciplinadas pela Portaria MTb. nº 3.214/78 e artigo 191, itens I e II da CLT e súmula n. 80 do TST.";
  const CSS_APROVADO = "body{font-family:\"Times New Roman\",Times,serif;margin:0;color:#111;background:#fff}.sheet.docx-template-a4{border:0;width:195mm;max-width:195mm;min-height:281.5mm;padding:0;margin:0 auto;font-family:\"Times New Roman\",Times,serif;color:#111}.docx-top{display:grid;grid-template-columns:29mm 1fr;gap:4mm;align-items:start;margin-bottom:3.5mm}.docx-logo{height:24mm;border:1px solid #d0d8df;display:flex;align-items:center;justify-content:center;overflow:hidden}.docx-logo img{max-width:100%;max-height:23mm;object-fit:contain}.docx-title{text-align:center;font-weight:900;text-decoration:underline;font-size:15pt;line-height:1.08;margin-top:4mm;text-transform:uppercase}.docx-meta{width:100%;border-collapse:collapse;margin:0 0 3.4mm 0}.docx-meta td{border:1px solid #4d5964;padding:2mm 2.3mm;font-size:11.3pt;line-height:1.05}.docx-meta td:nth-child(1){width:62%}.docx-meta td:nth-child(2){width:38%}.docx-term-title{text-align:center;text-decoration:underline;font-size:15.5pt;font-weight:900;margin:3mm 0 3mm}.docx-term p{font-size:11.7pt;line-height:1.48;text-align:justify;margin:0 0 2.9mm}.docx-local{font-size:11.7pt!important;font-weight:900!important;text-align:left!important;margin:6mm 0!important}.docx-date-spacer{display:inline-block;width:14mm}.docx-sign-area{text-align:center;margin:0 0 8mm}.docx-fingerprint{width:22mm;height:27mm;border:1px solid #b7c1c9;background:#fff;margin:0 auto 4mm;display:flex;align-items:center;justify-content:center;overflow:hidden}.docx-fingerprint img{max-width:100%;max-height:100%;object-fit:contain;filter:grayscale(1)}.docx-fingerprint.missing{font-family:Arial,Helvetica,sans-serif;font-size:6.5pt;color:#555;text-align:center;padding:3mm 1mm}.docx-sign-line{width:104mm;border-top:1px solid #222;margin:0 auto 1.2mm}.docx-worker-name{font-size:12pt;font-weight:900;text-align:center}.docx-epi-table{width:100%;border-collapse:collapse;margin-top:0}.docx-epi-table th,.docx-epi-table td{border:1px solid #4d5964;padding:1.9mm 1.8mm;font-size:10.8pt;line-height:1.05;color:#111}.docx-epi-table th{background:#fff;text-align:center;font-weight:900;text-transform:uppercase}.docx-epi-table td:nth-child(1),.docx-epi-table td:nth-child(3),.docx-epi-table td:nth-child(4),.docx-epi-table td:nth-child(5),.docx-epi-table td:nth-child(6),.docx-epi-table td:nth-child(7){text-align:center}.docx-epi-table td:nth-child(2){text-align:left}.docx-sign-cell{font-weight:900;text-align:center}.docx-validation-footer{font-family:Arial,Helvetica,sans-serif;font-size:6.5pt;color:#555;margin-top:3mm;border-top:1px solid #cfd7de;padding-top:1.5mm;text-align:left}@page{size:A4 portrait;margin:7.5mm 7.5mm 5mm 7.5mm}";
  const CSS_IMPRESSAO = `
    *{box-sizing:border-box}
    .sheet.docx-template-a4{width:194.5mm;max-width:194.5mm}
    .docx-term p{line-height:1.4}
    .docx-meta{table-layout:fixed}.docx-meta td{overflow-wrap:anywhere}
    .docx-top,.docx-meta,.docx-sign-area{break-inside:avoid;page-break-inside:avoid}
    .docx-term-title{break-after:avoid;page-break-after:avoid}
    .docx-term p{orphans:3;widows:3}
    .docx-epi-table{table-layout:fixed}
    .docx-epi-table th,.docx-epi-table td{font-size:10pt;padding:1.6mm 1.2mm;line-height:1.1}
    .docx-epi-table td:nth-child(3),.docx-epi-table td:nth-child(5){white-space:nowrap}
    .docx-sign-area{margin-bottom:6mm}
    .docx-validation-footer{margin-top:1.5mm;padding-top:1mm}
    .docx-local{margin:4mm 0!important}
    .docx-epi-table th,.docx-epi-table td{overflow-wrap:anywhere}
    .docx-epi-table thead{display:table-header-group}
    .docx-epi-table tr{break-inside:avoid;page-break-inside:avoid}
    .docx-sign-space{height:16mm}
    .docx-term .docx-sign-note{font:7pt Arial,sans-serif;margin:-2mm 0 3mm;color:#444;text-align:center}
    .docx-cancelled{border:1px solid #111;padding:2mm;margin-bottom:3mm;font-weight:bold;text-align:center}
    @media screen{body{padding:7.5mm 0 5mm}.sheet.docx-template-a4{min-height:0}}
  `;
  const fingerNames = {
    R_THUMB: "Polegar direito", R_INDEX: "Indicador direito", R_MIDDLE: "Médio direito",
    R_RING: "Anelar direito", R_LITTLE: "Mínimo direito", L_THUMB: "Polegar esquerdo",
    L_INDEX: "Indicador esquerdo", L_MIDDLE: "Médio esquerdo", L_RING: "Anelar esquerdo", L_LITTLE: "Mínimo esquerdo"
  };
  const text = value => String(value == null ? "" : value);
  const first = (...values) => values.find(value => value != null && text(value).trim() !== "") ?? "";
  const esc = value => text(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));

  function imageSource(value, allowUrl = false) {
    if (typeof value !== "string") return "";
    const src = value.trim();
    if (/^data:image\/(?:png|jpeg|jpg|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(src)) return src.replace(/\s/g, "");
    // Os registros antigos do leitor também podem guardar PNG/JPEG em base64 puro.
    if (/^(?:iVBORw0KGgo|\/9j\/)/.test(src) && /^[a-z0-9+/=\s]+$/i.test(src)) {
      return `data:image/${src.startsWith("/9j/") ? "jpeg" : "png"};base64,${src.replace(/\s/g, "")}`;
    }
    if (allowUrl && (/^https?:\/\//i.test(src) || /^\/(?!\/)/.test(src))) return src;
    return "";
  }

  function formatDate(value) {
    const raw = text(value).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);
    // Data de movimentação é uma data civil; não aplicar conversão de fuso horário.
    return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : raw;
  }

  function createSnapshot(empresa = {}, trabalhador = {}) {
    return {
      empresaSnapshot: {
        nome: first(empresa.nome, empresa.name), cnpj: first(empresa.cnpj),
        localidade: first(empresa.localidade, empresa.city), uf: first(empresa.uf, empresa.UF),
        logoDataUrl: imageSource(first(empresa.logoDataUrl, empresa.logoUrl, empresa.logo), true)
      },
      trabalhadorSnapshot: {
        nomeCompleto: first(trabalhador.nomeCompleto, trabalhador.nome, trabalhador.name),
        cpf: first(trabalhador.cpf), funcao: first(trabalhador.funcao, trabalhador.job, trabalhador.cargo),
        matriculaESocial: first(trabalhador.matriculaESocial, trabalhador.matriculaEsocial, trabalhador.esocial),
        localidade: first(trabalhador.localidade, trabalhador.city)
      },
      modeloFicha: {id: "JP-DOCX-11.10.6", formato: "A4-retrato", termoResponsabilidade: TERMO_APROVADO}
    };
  }

  function signatureInfo(ficha) {
    const record = ficha.assinaturaBiometrica || {};
    const image = [record.realFingerImage, record.fingerImageDataUrl, record.imageDataUrl, record.image].map(value => imageSource(value)).find(Boolean) || "";
    const signed = ficha.status === "assinada" || ficha.statusAnterior === "assinada" || ficha.signed === true;
    const verified = signed && record.verificada === true && !!image;
    let rowText = "Pendente";
    let note = "";
    if (verified) rowText = "Assinado Biometricamente";
    else if (signed) {
      rowText = "Assinatura registrada";
      note = "Registro de assinatura sem verificação biométrica disponível.";
    } else if (image) note = "Captura registrada; assinatura pendente de verificação.";
    const details = [];
    if (verified || image || signed) {
      const finger = first(record.dedo, record.fingerCode);
      if (finger) details.push(fingerNames[finger] || finger);
      if (record.quality != null || record.qualidade != null) details.push(`Qualidade ${first(record.quality, record.qualidade)}`);
      if (verified && first(record.matchScore, record.score)) details.push(`Conferência ${first(record.matchScore, record.score)}`);
      if (first(record.id, record.auditoriaId)) details.push(`Auditoria ${first(record.id, record.auditoriaId)}`);
      if (record.signedAt) details.push(`Data/hora ${record.signedAt}`);
    }
    return {image, verified, signed, rowText, note, details};
  }

// Used only as a fallback for old records that predate a separate display name.
function equipmentName(item = {}) {
  const explicit=String(item.epiNome || item.nomeCurto || item.nome || '').trim();
  if(explicit && explicit.length<=160)return explicit;
  const raw=String(item.epiDescricao || item.descricao || item.description || item.name || 'Equipamento').trim();
  if(raw.length<=160)return raw;
  const generic=raw.match(/^(capacete de seguran[çc]a|[óo]culos de seguran[çc]a|luva[s]? de seguran[çc]a|cal[çc]ado de seguran[çc]a|cintur[ãa]o de seguran[çc]a|protetor auditivo|respirador|talabarte|trava.quedas)\b/i);
  if(generic)return generic[1];
  return raw.split(/[.;\n]/)[0].slice(0,157).replace(/\s+\S*$/, '')+'…';
}

  function buildDocument(ficha, empresa = {}, trabalhador = {}, epis = [], options = {}) {
    if (!ficha || !ficha.id) throw new Error("Ficha não encontrada. Atualize a lista e tente novamente.");
    // Emissões novas preservam o cadastro existente na data da movimentação.
    // Registros legados utilizam os campos gravados na ficha antes do cadastro atual.
    const current = createSnapshot(empresa, trabalhador);
    const company = ficha.empresaSnapshot || current.empresaSnapshot;
    const worker = ficha.trabalhadorSnapshot || {
      ...current.trabalhadorSnapshot,
      nomeCompleto: first(ficha.trabalhadorNome, ficha.worker, current.trabalhadorSnapshot.nomeCompleto),
      cpf: first(ficha.cpf, current.trabalhadorSnapshot.cpf),
      funcao: first(ficha.funcao, ficha.job, current.trabalhadorSnapshot.funcao),
      matriculaESocial: first(ficha.matriculaESocial, ficha.esocial, current.trabalhadorSnapshot.matriculaESocial)
    };
    const workerName = first(worker.nomeCompleto, worker.nome, worker.name);
    if (!workerName) throw new Error("O nome do trabalhador não está disponível para esta ficha. Confira o cadastro antes de imprimir.");
    const date = formatDate(first(ficha.data, ficha.date));
    const type = first(ficha.tipo, ficha.type, "Entrega");
    const number = first(ficha.numero, ficha.id);
    const title = `Ficha de EPI - ${workerName} - ${date.replace(/\//g, "-") || "sem-data"}`;
    const locality = first(company.localidade, company.city, ficha.localidade, ficha.locality, worker.localidade);
    const uf = first(company.uf, company.UF);
    const localityWithUf = uf && !new RegExp(`(?:/|,|\\s)${text(uf).replace(/[^a-zA-Z]/g, "")}$`, "i").test(locality) ? `${locality}/${uf}` : locality;
    const logo = imageSource(first(company.logoDataUrl, company.logoUrl, company.logo), true) || imageSource(first(empresa.logoDataUrl, empresa.logoUrl, empresa.logo), true) || imageSource(options.defaultLogo, true);
    const signature = signatureInfo(ficha);
    const cancelled = ficha.status === "cancelada" || ficha.canceled === true;
    const term = first(ficha.modeloFicha && ficha.modeloFicha.termoResponsabilidade, TERMO_APROVADO);
    const items = Array.isArray(ficha.itens) ? ficha.itens : Array.isArray(ficha.epis) ? ficha.epis : [];
    if (!items.length) throw new Error("Esta ficha não possui EPIs para impressão.");
    const rows = items.map(item => {
      const epi = epis.find(entry => entry.id === item.epiId) || {};
      const requestedType=first(item.tipo,item.type);
      const itemType=['Entrega','Troca','Devolução'].includes(requestedType)?requestedType:type;
      const itemDate = formatDate(first(item.data, item.date, date));
      const returnDate = formatDate(first(item.dataDevolucao, item.returnDate, itemType === "Devolução" ? itemDate : ""));
      const signText = item.signed === false && signature.verified ? "Pendente" : signature.rowText;
      const caLabel = item.semCA === true ? "Sem CA" : first(item.ca, epi.ca);
      return `<tr><td>${esc(first(item.quantidade, item.qty, 1))}</td><td>${esc(equipmentName({...epi,...item}))}</td><td>${esc(caLabel)}</td><td>${esc(itemType)}</td><td>${esc(itemDate)}</td><td class="docx-sign-cell">${esc(signText)}</td><td>${esc(returnDate)}</td></tr>`;
    }).join("");
    const fingerprint = signature.image ? `<div class="docx-fingerprint"><img src="${esc(signature.image)}" alt="Imagem da captura biométrica registrada"></div>` : '<div class="docx-sign-space"></div>';
    const signatureNote = signature.note ? `<p class="docx-sign-note">${esc(signature.note)}</p>` : "";
    const footer = signature.details.length || signature.note ? `<div class="docx-validation-footer">${esc(signature.verified ? "Validação biométrica: " : "Registro de assinatura: ")}${esc([signature.note, ...signature.details].filter(Boolean).join(" | "))}</div>` : "";
    const content = `<main class="sheet docx-template-a4" data-template="JP-DOCX-11.10.6">
      <div class="docx-top"><div class="docx-logo">${logo ? `<img src="${esc(logo)}" alt="Logo da empresa">` : ""}</div><div class="docx-title">FICHA DE FORNECIMENTO DE EQUIPAMENTO DE PROTEÇÃO<br>INDIVIDUAL (EPI)</div></div>
      <table class="docx-meta"><tbody>
        <tr><td><b>Empresa:</b> ${esc(first(company.nome, company.name))}</td><td><b>CNPJ:</b> ${esc(company.cnpj)}</td></tr>
        <tr><td><b>Nome do Trabalhador:</b> ${esc(workerName)}</td><td><b>CPF:</b> ${esc(worker.cpf)}</td></tr>
        <tr><td><b>Função:</b> ${esc(first(worker.funcao, worker.job))}</td><td><b>Matrícula eSocial:</b> ${esc(first(worker.matriculaESocial, worker.matriculaEsocial, worker.esocial))}</td></tr>
        <tr><td><b>Tipo da movimentação:</b> ${esc(type)}</td><td><b>Ficha:</b> ${esc(number)}</td></tr>
      </tbody></table>
      ${cancelled ? `<div class="docx-cancelled">FICHA CANCELADA${ficha.motivoCancelamento ? ` - ${esc(ficha.motivoCancelamento)}` : ""}</div>` : ""}
      <section class="docx-term"><h1 class="docx-term-title">TERMO DE RESPONSABILIDADE</h1>${text(term).split(/\n\s*\n/).map(paragraph => `<p>${esc(paragraph)}</p>`).join("")}
        <p class="docx-local"><strong>Localidade da Empresa:</strong> ${esc(localityWithUf)} <span class="docx-date-spacer"></span> <strong>Data da Entrega:</strong> ${esc(date)}.</p>
        <div class="docx-sign-area">${fingerprint}${signatureNote}<div class="docx-sign-line"></div><div class="docx-worker-name">${esc(workerName)}</div></div>
      </section>
      <table class="docx-epi-table" aria-label="Relação dos EPIs"><colgroup><col style="width:6%"><col style="width:26%"><col style="width:9%"><col style="width:10.5%"><col style="width:13.5%"><col style="width:20%"><col style="width:15%"></colgroup><thead><tr><th>QTD</th><th>EPI</th><th>CA</th><th>STATUS</th><th>DATA</th><th>ASSINATURA</th><th>DATA DEVOLUÇÃO</th></tr></thead><tbody>${rows}</tbody></table>${footer}
    </main>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS_APROVADO}${CSS_IMPRESSAO}</style></head><body>${content}</body></html>`;
  }

  root.JP_FICHA = Object.freeze({createSnapshot, buildDocument, formatDate,equipmentName});
})(typeof window !== "undefined" ? window : globalThis);
