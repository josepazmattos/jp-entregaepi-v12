import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { sha256 } from './document-integrity.js';
import { buildSigningPdf } from './jpged-pdf.js';
import { statusFicha, STATUS } from './relatorios.service.js';
export const COLUMNS=[['empresa','Empresa'],['cnpj','CNPJ/CAEPF'],['endereco','Endereço na ficha'],['nome','Trabalhador'],['cpf','CPF'],['matricula','Matrícula eSocial'],['funcao','Função'],['setor','Setor'],['admissao','Admissão'],['statusTrabalhador','Situação atual do trabalhador'],['equipamento','Equipamento'],['ca','CA'],['fabricante','Fabricante'],['modelo','Modelo'],['tamanho','Tamanho'],['quantidade','Quantidade'],['tipo','Movimentação'],['data','Data da movimentação'],['numero','Ficha'],['situacaoTexto','Situação documental'],['assinadaEm','Assinatura em'],['certificadaEm','Certificação em'],['criadoPor','Registrado por'],['criadoEm','Registrado em'],['orientacao','Orientação'],['relacao','Relação de entrega rápida'],['pendencias','Pendências para conferência']];
const display=x=>Array.isArray(x)?x.join('; '):x==null||x===''?'Não informado':x;
export async function reportXlsx(report){
  const book=new ExcelJS.Workbook();book.creator='JP EntregaEPI';
  const sheet=book.addWorksheet('Movimentações');sheet.columns=COLUMNS.map(([key,header])=>({key,header,width:['equipamento','pendencias','nome','orientacao'].includes(key)?45:24}));
  for(const row of report.rows)sheet.addRow(Object.fromEntries(COLUMNS.map(([key])=>[key,display(row[key])])));
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:COLUMNS.length}};
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF12613F'}};
  const meta=book.addWorksheet('Resumo e filtros');meta.columns=[{width:36},{width:100}];
  meta.addRows([['Relatório analítico de EPI',report.empresa.nome],['CNPJ/CAEPF',report.empresa.cnpj],['Emissão',report.geradoEm],['Emitido por',report.geradoPor],['Totais','Excluem fichas canceladas nas quantidades. Não comprovam por si só recebimento.'],...Object.entries(report.summary),['Filtros aplicados',''],...Object.entries(report.filters)]);
  const workers=book.addWorksheet('Por trabalhador');workers.columns=[{header:'Trabalhador',key:'nome',width:45},{header:'Matrícula',key:'matricula',width:25},{header:'Fichas',key:'fichas',width:12},{header:'Última movimentação',key:'ultimaMovimentacao',width:24},{header:'Fichas com pendências',key:'pendencias',width:24}];workers.addRows(report.workers);
  const missing=book.addWorksheet('Sem movimentação no período');missing.columns=[{header:'Nome',key:'nome',width:45},{header:'Matrícula',key:'matricula',width:25},{header:'Situação atual',key:'status',width:25}];missing.addRows(report.semMovimentacao);missing.addRow({nome:'Ausência de registro no período não comprova ausência de entrega.'});
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function reportPdf(report){
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(readFileSync(new URL('../data/fonts/DejaVuSerif.ttf',import.meta.url)),{subset:true});
  const width=841.89,height=595.28,margin=28,cols=[135,145,55,38,65,65,118,165-margin*2];let page,y;
  const clean=v=>String(display(v)).replace(/[\u0000-\u001f]/g,' ');
  const wrap=(value,w,size=8)=>{const result=[];let line='';for(const ch of clean(value)){if(font.widthOfTextAtSize(line+ch,size)>w){result.push(line);line='';}line+=ch;}result.push(line);return result;};
  function add(){page=doc.addPage([width,height]);y=height-margin;}
  function text(v,size=9){for(const line of wrap(v,width-2*margin,size)){if(y<45)add();page.drawText(line,{x:margin,y:y-size,size,font});y-=size+4;}}
  function row(values,header=false){const parts=values.map((v,i)=>wrap(v,cols[i]-8)),h=Math.max(...parts.map(v=>v.length))*11+9;if(y-h<40){add();heading();}let x=margin;parts.forEach((lines,i)=>{page.drawRectangle({x,y:y-h,width:cols[i],height:h,borderWidth:.4,borderColor:rgb(.5,.6,.55),color:header?rgb(.9,.95,.92):rgb(1,1,1)});lines.forEach((line,n)=>page.drawText(line,{x:x+4,y:y-13-11*n,size:8,font}));x+=cols[i];});y-=h;}
  function heading(){row(['Trabalhador / matrícula','Equipamento / fabricante / tamanho','CA','Qtd.','Movimentação','Data','Ficha / situação','Pendências'],true);}
  add();text('JP · RELATÓRIO ANALÍTICO DE EPI',16);text(`${report.empresa.nome} · CNPJ/CAEPF: ${report.empresa.cnpj}`,11);text(`Emitido em ${report.geradoEm} por ${report.geradoPor}`);text('Filtros: '+JSON.stringify(report.filters));text(`Fichas: ${report.summary.fichas} · Trabalhadores: ${report.summary.trabalhadores} · Quantidades: entregas ${report.summary.entregas}, trocas ${report.summary.trocas}, devoluções ${report.summary.devolucoes}`);text('Cancelamentos são excluídos das quantidades. Consulte as fichas originais para comprovação.');y-=8;heading();
  for(const r of report.rows)row([`${r.nome}\nMatrícula: ${r.matricula||'Não informada'}\nCPF: ${r.cpf||'Não informado'}`,`${r.equipamento} · ${r.fabricante||''} · ${r.tamanho||''}`,r.ca,r.quantidade,r.tipo,r.data,`${r.numero} · ${r.situacaoTexto}`,r.pendencias.join('; ')||'Sem apontamento']);
  y-=15;text('Trabalhadores sem movimentação registrada no período',12);text('A ausência de registro não comprova ausência de entrega.');for(const w of report.semMovimentacao)text(`${w.nome} · Matrícula: ${w.matricula||'Não informada'} · ${w.status}`);
  doc.getPages().forEach((p,i,pages)=>p.drawText(`JP EntregaEPI · Página ${i+1}/${pages.length}`,{x:margin,y:18,size:8,font}));return Buffer.from(await doc.save());
}
export async function fichasZip({fichas,ged,empresaId}){
  const zip=new JSZip(),index=[],errors=[];let size=0;
  for(const ficha of fichas){
    const state=statusFicha(ficha);const base=String(ficha.numero||ficha.id).replace(/[^a-zA-Z0-9._-]/g,'_')+'_'+ficha.id;
    try{
      let pdf,kind;
      if(ficha.certificacao?.documentId){const doc=await ged.get(empresaId,'DOC',ficha.certificacao.documentId);if(!doc||doc.fichaId!==ficha.id||!doc.path.startsWith(`documents/${empresaId}/`))throw Error('Original certificado indisponível');pdf=await ged.readBlob(doc.path);if(sha256(pdf)!==doc.pdfHash)throw Error('Integridade do original divergente');kind='original_certificado';}
      else if(state==='certificada')throw Error('Original certificado não vinculado');
      else{pdf=(await buildSigningPdf(ficha)).pdf;kind='copia_consulta';}
      size+=pdf.length;if(size>64*1024*1024)throw Error('Limite de tamanho desta parte excedido');
      const file=`${state==='cancelada'?'canceladas':kind}/${base}.pdf`;zip.file(file,pdf);index.push({ficha:ficha.numero||ficha.id,data:ficha.data,situacao:STATUS[state],arquivo:file,sha256:sha256(pdf)});
    }catch(error){errors.push({ficha:ficha.numero||ficha.id,erro:['Original certificado indisponível','Integridade do original divergente','Original certificado não vinculado','Limite de tamanho desta parte excedido'].includes(error.message)?error.message:'Não foi possível obter o documento'});}
  }
  zip.file('Indice_das_fichas.json',JSON.stringify({empresaId,solicitadas:fichas.length,incluidas:index.length,completo:errors.length===0,documentos:index,pendencias:errors},null,2));
  zip.file('LEIA-ME.txt',`Fichas solicitadas: ${fichas.length}\nIncluídas: ${index.length}\nPendências: ${errors.length}\nOriginais certificados foram preservados byte a byte. Cópias para consulta não recebem assinatura digital. Fichas canceladas estão separadas.\n\n`+index.map(x=>`${x.ficha} | ${x.data} | ${x.situacao} | ${x.arquivo}`).join('\n')+'\n\n'+errors.map(x=>`${x.ficha}: ${x.erro}`).join('\n'));
  return {bytes:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),incluidas:index.length,pendencias:errors,solicitadas:fichas.length};
}
