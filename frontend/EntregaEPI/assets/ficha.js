(function (root) {
  "use strict";

// Cada ficha conserva o texto e a versão confirmados pelo trabalhador.
const MODELO_LEGADO_ID = "JP-DOCX-11.10.6";
const TERMO_LEGADO = "Declaro sob minha inteira responsabilidade a guarda e conservação dos equipamentos de proteção individual constantes nesta ficha-controle. Assumo também a responsabilidade de os devolver integralmente ou parcialmente, quando solicitado, ou por ocasião de eventual rescisão de contrato, na data do respectivo aviso de qualquer das partes.\n\nTambém estou ciente que, na eventualidade de danificar ou extraviar o equipamento por ato doloso ou culposo, estarei sujeito ao desconto do valor em meu salário, conforme parágrafo único do art. 158 da CLT. Também me comprometo a utilizá-los de forma correta e de acordo com as instruções de treinamento referentes ao uso correto, guarda conservação e higienização dos EPI, recebidas na presente data, fornecidas por profissional Técnico de Segurança do Trabalho. Também estou ciente que a não utilização dos mesmos em minhas atividades profissionais, é ato faltoso e passível de punições legais e disciplinares de acordo com a Consolidação das leis do Trabalho (CLT) – Capítulo V – Seção I – Art. 158o. c/c Norma Regulamentadora (NR) - NR-1 e NR-6, alínea 6.7, disciplinadas pela Portaria MTb. nº 3.214/78 e artigo 191, itens I e II da CLT e súmula n. 80 do TST.";
const MODELO_FICHA_ID = "JP-FICHA-20261030-ASSINATURA";
const TERMO_ASSINATURA_ID = "JP-ASSINATURA-BIOMETRICA-20261030-v1";
const TERMO_ASSINATURA = "Após conferir os itens, quantidades, datas e declarações desta ficha, confirmo seu conteúdo e reconheço a captura biométrica realizada por mim, digital ou facial conforme o método registrado, como minha assinatura eletrônica deste documento. Esta confirmação é vinculada exclusivamente a esta ficha e às evidências de autoria e integridade registradas pelo sistema.";
const RESPONSABILIDADE = "Comprometo-me a utilizar os EPIs para a finalidade prevista, cumprir as orientações recebidas e comunicar dúvidas, danos, extravio ou condições que os tornem impróprios para uso. Responsabilizo-me pela limpeza, guarda e conservação que me competem, sem afastar as obrigações da empresa previstas na NR-6. A recusa injustificada ao uso dos EPIs poderá caracterizar ato faltoso, conforme o art. 158 da CLT. Eventual desconto por dano dependerá de apuração e do atendimento ao art. 462, § 1º, da CLT; não será automático nem decorrente do desgaste normal.";
const TREINAMENTO_ANTERIOR = "Declaro que fui treinado e orientado anteriormente à entrega dos EPIs recebidos, quanto ao uso, ajuste, limitações de proteção, limpeza, guarda, conservação e necessidade de substituição.";
const RECEBIMENTO = "Declaro ter recebido gratuitamente os itens relacionados nesta ficha, nas quantidades e datas de entrega discriminadas.";
const DEVOLUCAO = "Confirmo a devolução dos itens relacionados nesta ficha, nas quantidades e datas de devolução discriminadas.";
const MOVIMENTACAO_MISTA = "Confirmo as movimentações discriminadas nesta ficha: recebi gratuitamente os itens indicados como entrega ou troca e devolvi os indicados como devolução, nas respectivas quantidades e datas.";
function modeloFichaParaItens(itens = []) {
  const tipos = [...new Set(itens.map(item => item.tipoMovimentacao || 'Entrega'))];
  const somenteDevolucao = tipos.length === 1 && tipos[0] === 'Devolução';
  const mista = tipos.includes('Devolução') && !somenteDevolucao;
  const entregaEpi = !itens.length || itens.some(item => item.tipoMovimentacao !== 'Devolução' && !['instrumento','uniforme','acessorio','outro_nao_epi'].includes(item.enquadramento));
  const termoResponsabilidade = somenteDevolucao ? DEVOLUCAO
    : (mista ? MOVIMENTACAO_MISTA : RECEBIMENTO) + (entregaEpi ? ' ' + TREINAMENTO_ANTERIOR + '\n\n' + RESPONSABILIDADE : '');
  const outros = itens.some(item => item.semCA === true || item.tipo === 'sem_ca');
  return { id: MODELO_FICHA_ID, formato: 'A4-retrato',
    titulo: outros ? 'FICHA DE CONTROLE DE EPIs E OUTROS EQUIPAMENTOS' : 'FICHA DE CONTROLE DE EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL',
    termoResponsabilidade,termoAssinatura:TERMO_ASSINATURA,termoAssinaturaId:TERMO_ASSINATURA_ID };
}
const MODELO_FICHA_APROVADO = Object.freeze(modeloFichaParaItens());
const TERMO_APROVADO = MODELO_FICHA_APROVADO.termoResponsabilidade;

  const CSS_APROVADO = "body{font-family:\"Times New Roman\",Times,serif;margin:0;color:#111;background:#fff}.sheet.docx-template-a4{border:0;width:195mm;max-width:195mm;min-height:281.5mm;padding:0;margin:0 auto;font-family:\"Times New Roman\",Times,serif;color:#111}.docx-top{display:grid;grid-template-columns:29mm 1fr;gap:4mm;align-items:start;margin-bottom:3.5mm}.docx-logo{height:24mm;border:1px solid #d0d8df;display:flex;align-items:center;justify-content:center;overflow:hidden}.docx-logo img{max-width:100%;max-height:23mm;object-fit:contain}.docx-title{text-align:center;font-weight:900;text-decoration:underline;font-size:15pt;line-height:1.08;margin-top:4mm;text-transform:uppercase}.docx-meta{width:100%;border-collapse:collapse;margin:0 0 3.4mm 0}.docx-meta td{border:1px solid #4d5964;padding:2mm 2.3mm;font-size:11.3pt;line-height:1.05}.docx-meta td:nth-child(1){width:62%}.docx-meta td:nth-child(2){width:38%}.docx-term-title{text-align:center;text-decoration:underline;font-size:15.5pt;font-weight:900;margin:3mm 0 3mm}.docx-term p{font-size:11.7pt;line-height:1.48;text-align:justify;margin:0 0 2.9mm}.docx-local{font-size:11.7pt!important;font-weight:900!important;text-align:left!important;margin:6mm 0!important}.docx-date-spacer{display:inline-block;width:14mm}.docx-sign-area{text-align:center;margin:0 0 8mm}.docx-fingerprint{width:22mm;height:27mm;border:1px solid #b7c1c9;background:#fff;margin:0 auto 4mm;display:flex;align-items:center;justify-content:center;overflow:hidden}.docx-fingerprint img{max-width:100%;max-height:100%;object-fit:contain;filter:grayscale(1)}.docx-fingerprint.missing{font-family:Arial,Helvetica,sans-serif;font-size:6.5pt;color:#555;text-align:center;padding:3mm 1mm}.docx-sign-line{width:104mm;border-top:1px solid #222;margin:0 auto 1.2mm}.docx-worker-name{font-size:12pt;font-weight:900;text-align:center}.docx-epi-table{width:100%;border-collapse:collapse;margin-top:0}.docx-epi-table th,.docx-epi-table td{border:1px solid #4d5964;padding:1.9mm 1.8mm;font-size:10.8pt;line-height:1.05;color:#111}.docx-epi-table th{background:#fff;text-align:center;font-weight:900;text-transform:uppercase}.docx-epi-table td:nth-child(1),.docx-epi-table td:nth-child(3),.docx-epi-table td:nth-child(4),.docx-epi-table td:nth-child(5),.docx-epi-table td:nth-child(6),.docx-epi-table td:nth-child(7){text-align:center}.docx-epi-table td:nth-child(2){text-align:left}.docx-sign-cell{font-weight:900;text-align:center}.docx-validation-footer{font-family:Arial,Helvetica,sans-serif;font-size:6.5pt;color:#555;margin-top:3mm;border-top:1px solid #cfd7de;padding-top:1.5mm;text-align:left}@page{size:A4 portrait;margin:7.5mm 7.5mm 5mm 7.5mm}";
  const CSS_IMPRESSAO = `
    *{box-sizing:border-box}
    .sheet.docx-template-a4{width:194.5mm;max-width:194.5mm}
    .docx-term p{line-height:1.4}.docx-term .docx-signature-term{font-size:10pt;line-height:1.25}
    .docx-meta{table-layout:fixed}.docx-meta td{overflow-wrap:anywhere}
    .docx-top,.docx-meta,.docx-sign-area{break-inside:avoid;page-break-inside:avoid}
    .docx-term-title{break-after:avoid;page-break-after:avoid}
    .docx-term p{orphans:3;widows:3}
    .docx-epi-table{table-layout:fixed}
    .docx-epi-table th,.docx-epi-table td{font-size:10pt;padding:1.6mm 1.2mm;line-height:1.1}
    .docx-epi-table td:nth-child(5){white-space:nowrap}
    .docx-sign-area{margin-bottom:6mm}
    .docx-validation-footer{margin-top:1.5mm;padding-top:1mm}
    .docx-local{margin:4mm 0!important}
    .docx-epi-table th,.docx-epi-table td{overflow-wrap:anywhere}
    .docx-epi-table thead{display:table-header-group}
    .docx-epi-table tr{break-inside:avoid;page-break-inside:avoid}
    .docx-sign-space{height:16mm}
    .docx-term .docx-sign-note{font:7pt Arial,sans-serif;margin:-2mm 0 3mm;color:#444;text-align:center}
    .docx-cancelled{border:1px solid #111;padding:2mm;margin-bottom:3mm;font-weight:bold;text-align:center}
    @media screen{body{padding:20px 0}.sheet.docx-template-a4{min-height:0;width:calc(100% - 32px);max-width:194.5mm}.docx-sign-line{max-width:100%}.docx-worker-name,.docx-validation-footer{overflow-wrap:anywhere}.docx-table-scroll{overflow-x:auto;max-width:100%;overscroll-behavior-x:contain}.docx-epi-table{min-width:700px}.docx-table-scroll:focus-visible{outline:2px solid #078448;outline-offset:2px}.docx-scroll-hint{font:14px Arial,sans-serif;color:#465c50;margin:8px 0}.docx-term p{font-size:16px;line-height:1.5}}
    @media screen and (max-width:520px){.docx-top{grid-template-columns:72px minmax(0,1fr);gap:12px}.docx-logo{height:66px}.docx-title{font-size:17px;margin-top:0;overflow-wrap:anywhere}.docx-meta,.docx-meta tbody,.docx-meta tr,.docx-meta td{display:block}.docx-meta td:nth-child(n){width:100%;font-size:16px;line-height:1.4}.docx-meta td{border-bottom:0}.docx-meta tr:last-child td:last-child{border-bottom:1px solid #4d5964}.docx-term-title{font-size:20px}.docx-term p{text-align:left}.docx-date-spacer{display:block;height:8px}.docx-validation-footer{font-size:11px}}
    @media screen and (min-width:760px){.docx-scroll-hint{display:none}}
    @media print{.docx-scroll-hint{display:none}.docx-table-scroll{display:contents}}
  `;
  const NON_EPI = Object.freeze({instrumento:"Instrumento",uniforme:"Uniforme",acessorio:"Acessório",outro_nao_epi:"Outro equipamento (não EPI)"});
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

  function createSnapshot(empresa = {}, trabalhador = {}, itens = []) {
    return {
      empresaSnapshot: {
        nome: first(empresa.nome, empresa.name), cnpj: first(empresa.cnpj), ...(empresa.inscricaoTipo==='CAEPF'?{inscricaoTipo:'CAEPF'}:{}),
        localidade: first(empresa.localidade, empresa.city), uf: first(empresa.uf, empresa.UF),
        logoDataUrl: imageSource(first(empresa.logoDataUrl, empresa.logoUrl, empresa.logo), true)
      },
      trabalhadorSnapshot: {
        nomeCompleto: first(trabalhador.nomeCompleto, trabalhador.nome, trabalhador.name),
        cpf: first(trabalhador.cpf), funcao: first(trabalhador.funcao, trabalhador.job, trabalhador.cargo),
        matriculaESocial: first(trabalhador.matriculaESocial, trabalhador.matriculaEsocial, trabalhador.esocial),
        localidade: first(trabalhador.localidade, trabalhador.city)
      },
      modeloFicha: modeloFichaParaItens(itens)
    };
  }

  function signatureInfo(ficha) {
    const record = ficha.assinaturaBiometrica || {};
    const image = [record.realFingerImage, record.fingerImageDataUrl, record.imageDataUrl, record.image].map(value => imageSource(value)).find(Boolean) || "";
    const signed = ficha.status === "assinada" || ficha.statusAnterior === "assinada" || ficha.signed === true;
    const facial = record.metodo === 'AWS_REKOGNITION_FACE_LIVENESS';
    const verified = signed && record.verificada === true && (facial ? !!record.proofSignature && !!record.keyArn : !!image);
    let rowText = "Pendente";
    let note = "";
    if (verified) rowText = facial ? "Biometria Facial" : ficha.modeloFicha?.termoAssinatura ? "Biometria Digital" : "Assinado Biometricamente";
    else if (signed) {
      rowText = "Assinatura registrada";
      note = "Registro de assinatura sem verificação biométrica disponível.";
    } else if (image) note = "Captura registrada; assinatura pendente de verificação.";
    const details = [];
    if (verified || image || signed) {
      if(verified&&(facial||ficha.modeloFicha?.termoAssinatura))details.push(facial ? "Método facial" : "Método digital");
      const finger = first(record.dedo, record.fingerCode);
      if (finger) details.push(fingerNames[finger] || finger);
      if (record.quality != null || record.qualidade != null) details.push(`Qualidade ${first(record.quality, record.qualidade)}`);
      if (verified && first(record.matchScore, record.score)) details.push(`Conferência ${first(record.matchScore, record.score)}`);
      if (first(record.id, record.auditoriaId)) details.push(`Auditoria ${first(record.id, record.auditoriaId)}`);
      if (record.signedAt) details.push(`Data/hora ${record.signedAt}`);
    }
    return {image, verified, signed, rowText, note, details,facial};
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
    // Only newly issued returns carry this date. Preserve the rendering of historical documents.
    const returnOnly = type === 'Devolução' && Boolean(ficha.datasMovimentacao?.devolucao);
    const mixedMovement = type.includes(' e ');
    const number = first(ficha.numero, ficha.id);
    const title = `Ficha de EPI - ${workerName} - ${date.replace(/\//g, "-") || "sem-data"}`;
    const locality = first(company.localidade, company.city, ficha.localidade, ficha.locality, worker.localidade);
    const uf = first(company.uf, company.UF);
    const localityWithUf = uf && !new RegExp(`(?:/|,|\\s)${text(uf).replace(/[^a-zA-Z]/g, "")}$`, "i").test(locality) ? `${locality}/${uf}` : locality;
    const logo = imageSource(first(company.logoDataUrl, company.logoUrl, company.logo), true) || imageSource(first(empresa.logoDataUrl, empresa.logoUrl, empresa.logo), true) || imageSource(options.defaultLogo, true);
    const signature = signatureInfo(ficha);
    const cancelled = ficha.status === "cancelada" || ficha.canceled === true;
    const term = first(ficha.modeloFicha && ficha.modeloFicha.termoResponsabilidade, TERMO_LEGADO);
    const items = Array.isArray(ficha.itens) ? ficha.itens : Array.isArray(ficha.epis) ? ficha.epis : [];
    if (!items.length) throw new Error("Esta ficha não possui EPIs para impressão.");
    const itemMovements = items.some(item => item.tipoMovimentacao && item.datasMovimentacao);
    const columnWidths = itemMovements ? [8,22.5,9,12,13.5,20,15] : [6,26,9,10.5,13.5,20,15];
    const rows = items.map(item => {
      const epi = epis.find(entry => entry.id === item.epiId) || {};
      const requestedType=first(item.tipoMovimentacao,item.tipo,item.type);
      const itemType=['Entrega','Troca','Devolução'].includes(requestedType)?requestedType:type;
      const itemDate = formatDate(first(item.data, item.date, date));
      const datedMovement = Boolean(item.tipoMovimentacao && item.datasMovimentacao);
      const returnDate = datedMovement ? formatDate(item.datasMovimentacao.devolucao) : formatDate(first(item.dataDevolucao, item.returnDate, returnOnly ? ficha.datasMovimentacao.devolucao : '', itemType === "Devolução" ? itemDate : ""));
      const deliveryDate = datedMovement ? formatDate(item.datasMovimentacao.entrega) : returnOnly ? '' : itemDate;
      const signText = item.signed === false && signature.verified ? "Pendente" : signature.rowText;
      const caLabel = item.semCA === true ? (NON_EPI[item.enquadramento] ? "CA não aplicável" : "Sem CA") : first(item.ca, epi.ca);
      const name = equipmentName({...epi,...item});
      const detail = item.enquadramento ? [NON_EPI[item.enquadramento] || (item.enquadramento === "epi" ? "EPI" : "Enquadramento não informado"), item.fabricante, item.modelo, item.tamanho].filter(Boolean).join(" · ") : "";
      return `<tr><td>${esc(first(item.quantidade, item.qty, 1))}</td><td>${esc(name)}${detail ? `<br><small>${esc(detail)}</small>` : ""}</td><td>${esc(caLabel)}</td><td>${esc(itemType)}</td><td>${esc(deliveryDate)}</td><td class="docx-sign-cell">${esc(signText)}</td><td>${esc(returnDate)}</td></tr>`;
    }).join("");
    const fingerprint = signature.verified && signature.facial ? `<div class="docx-fingerprint missing"><strong>ASSINATURA<br>BIOMÉTRICA FACIAL<br>VERIFICADA</strong></div>` : signature.image ? `<div class="docx-fingerprint"><img src="${esc(signature.image)}" alt="Imagem da captura biométrica registrada"></div>` : '<div class="docx-sign-space"></div>';
    const signatureNote = signature.note ? `<p class="docx-sign-note">${esc(signature.note)}</p>` : "";
    const footer = signature.details.length || signature.note ? `<div class="docx-validation-footer">${esc(signature.verified ? "Validação biométrica: " : "Registro de assinatura: ")}${esc([signature.note, ...signature.details].filter(Boolean).join(" | "))}</div>` : "";
    const content = `<main class="sheet docx-template-a4" data-template="${esc(ficha.modeloFicha?.id || MODELO_LEGADO_ID)}">
      <div class="docx-top"><div class="docx-logo">${logo ? `<img src="${esc(logo)}" alt="Logo da empresa">` : ""}</div><div class="docx-title">${esc(ficha.modeloFicha?.titulo || "FICHA DE FORNECIMENTO DE EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL (EPI)")}</div></div>
      <table class="docx-meta"><tbody>
        <tr><td><b>Empresa:</b> ${esc(first(company.nome, company.name))}</td><td><b>${company.inscricaoTipo==='CAEPF'?'CAEPF':'CNPJ'}:</b> ${esc(company.cnpj)}</td></tr>
        <tr><td><b>Nome do Trabalhador:</b> ${esc(workerName)}</td><td><b>CPF:</b> ${esc(worker.cpf)}</td></tr>
        <tr><td><b>Função:</b> ${esc(first(worker.funcao, worker.job))}</td><td><b>Matrícula eSocial:</b> ${esc(first(worker.matriculaESocial, worker.matriculaEsocial, worker.esocial))}</td></tr>
        <tr><td><b>Tipo da movimentação:</b> ${esc(type)}</td><td><b>Ficha:</b> ${esc(number)}</td></tr>
      </tbody></table>
      ${cancelled ? `<div class="docx-cancelled">FICHA CANCELADA${ficha.motivoCancelamento ? ` - ${esc(ficha.motivoCancelamento)}` : ""}</div>` : ""}
      <section class="docx-term"><h1 class="docx-term-title">TERMO DE RESPONSABILIDADE</h1>${text(term).split(/\n\s*\n/).map(paragraph => `<p>${esc(paragraph)}</p>`).join("")}
        ${ficha.modeloFicha?.termoAssinatura ? `<p class="docx-signature-term"><strong>Confirmação da assinatura eletrônica:</strong> ${esc(ficha.modeloFicha.termoAssinatura)}</p>` : ""}
        <p class="docx-local"><strong>Localidade da Empresa:</strong> ${esc(localityWithUf)} <span class="docx-date-spacer"></span> <strong>${mixedMovement?'Data das Movimentações:':returnOnly?'Data da Devolução:':'Data da Entrega:'}</strong> ${esc(returnOnly?formatDate(ficha.datasMovimentacao.devolucao):date)}.</p>
        <div class="docx-sign-area">${fingerprint}${signatureNote}<div class="docx-sign-line"></div><div class="docx-worker-name">${esc(workerName)}</div></div>
      </section>
      <p class="docx-scroll-hint">Deslize a tabela para consultar todas as colunas.</p><div class="docx-table-scroll" role="region" tabindex="0" aria-label="Equipamentos da ficha — tabela com rolagem horizontal"><table class="docx-epi-table${itemMovements?' docx-item-movements':''}" aria-label="Relação dos EPIs"><colgroup>${columnWidths.map(width=>`<col style="width:${width}%">`).join('')}</colgroup><thead><tr><th>QTD</th><th>${(ficha.modeloFicha?.id || "").startsWith("JP-FICHA-20261030") ? "EQUIPAMENTO" : "EPI"}</th><th>CA</th><th>STATUS</th><th>${itemMovements?'DATA ENTREGA':'DATA'}</th><th>ASSINATURA</th><th>DATA DEVOLUÇÃO</th></tr></thead><tbody>${rows}</tbody></table></div>${footer}
    </main>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS_APROVADO}${CSS_IMPRESSAO}${itemMovements?'.docx-item-movements td:nth-child(1),.docx-item-movements td:nth-child(4){white-space:nowrap}':''}</style></head><body>${content}</body></html>`;
  }

  root.JP_FICHA = Object.freeze({createSnapshot, buildDocument, formatDate,equipmentName});
})(typeof window !== "undefined" ? window : globalThis);
