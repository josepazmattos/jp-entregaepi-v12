import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
export async function makePdf(record, evidence = false) {
  const pdf=await PDFDocument.create();
  pdf.setTitle('TESTE - '+(evidence?'Relatório de evidências':record.type==='ENROLL'?'Cadastro facial':'Ficha de EPI'));
  pdf.setAuthor('JP Segurança do Trabalho');
  pdf.registerFontkit(fontkit);
  const regularBytes=await readFile(process.env.LAMBDA_TASK_ROOT?process.env.LAMBDA_TASK_ROOT+'/font.ttf':new URL('../../../backend/src/data/fonts/DejaVuSerif.ttf',import.meta.url));
  const boldBytes=await readFile(process.env.LAMBDA_TASK_ROOT?process.env.LAMBDA_TASK_ROOT+'/font-bold.ttf':new URL('../../../backend/src/data/fonts/DejaVuSerif-Bold.ttf',import.meta.url));
  const regular=await pdf.embedFont(regularBytes,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true});
  const clean=s=>String(s??'').normalize('NFC').replace(/[^\x20-\x7e\u00a0-\u00ff]/g,' ');
  let page,y,number=0;
  const newPage=()=>{page=pdf.addPage([595.28,841.89]);number++;y=740;page.drawRectangle({x:0,y:810,width:595.28,height:32,color:rgb(.03,.33,.23)});page.drawText('JP SEGURANCA DO TRABALHO | ENTREGA EPI',{x:42,y:821,font:bold,size:10,color:rgb(1,1,1)});page.drawText('TESTE - SEM VALIDADE COMO RECIBO DE ENTREGA',{x:42,y:780,font:bold,size:11,color:rgb(.65,.20,.04)});page.drawText('Pagina '+number+' | Documento experimental. Sem assinatura ICP-Brasil.',{x:42,y:25,font:regular,size:8,color:rgb(.35,.35,.35)});};
  const line=(value,strong=false)=>{
    const font=strong?bold:regular,words=clean(value).split(/\s+/);let current='';
    for(const word of words){
      if(font.widthOfTextAtSize(current+' '+word,10)>505 && current){if(y<65)newPage();page.drawText(current,{x:42,y,font,size:10});y-=15;current=word;}
      else current+=(current?' ':'')+word;
    }
    // Hashes are split explicitly; arbitrary labels are wrapped, never interpreted as markup.
    if(y<65)newPage();page.drawText(current,{x:42,y,font,size:10});y-=18;
  };
  const hash=(label,value)=>{line(label,true);String(value||'').match(/.{1,48}/g)?.forEach(part=>line(part));};
  newPage();
  line(evidence?'RELATORIO DE EVIDENCIAS FACIAIS':record.type==='ENROLL'?'CADASTRO FACIAL DE TESTE':'FICHA DE EPI DE TESTE',true);y-=6;
  line('Participante: '+record.name);line('Empresa de teste: '+record.company);
  line('Protocolo: '+record.id);line('Data e hora: '+new Date(record.createdAt).toLocaleString('pt-BR',{timeZone:'America/Campo_Grande'})+' (UTC-04:00)');
  line('Metodo: BIOMETRIA FACIAL. Nao foi exigida impressao digital.');
  if(record.type==='RECEIPT'){
    y-=7;line('ITENS APRESENTADOS E CONFIRMADOS NO TESTE',true);
    for(const [i,item] of record.snapshot.items.entries())line(`${i+1}. ${item.description} | Quantidade: ${item.quantity} | CA: ${item.ca||'nao informado no teste'}`);
    y-=7;line(record.snapshot.statement);
    line('Comparacao facial: aprovada no criterio experimental.');
  }else{
    line('Cadastro inicial com prova de vida e declaracao do operador sobre conferencia da identidade.');
    line('Este cadastro, sozinho, nao comprova recebimento de EPI.');
  }
  line('Prova de vida: aprovada no criterio experimental.');
  line('Fornecedor: AWS Rekognition, regiao Sao Paulo.');
  hash('SHA-256 do conteudo apresentado:',record.contentHash);hash('SHA-256 do conjunto de evidencias:',record.evidenceHash);
  if(evidence){
    y-=6;line('DADOS TECNICOS DA VERIFICACAO',true);
    line('Sessao do fornecedor: '+record.proof.sessionId);
    line('Requisicao do resultado: '+record.proof.resultRequestId);
    line('Score de prova de vida: '+record.proof.livenessScore+' | Limiar: '+record.proof.thresholds.liveness);
    if(record.proof.comparison)line('Similaridade: '+record.proof.comparison.similarity+' | Limiar: '+record.proof.thresholds.similarity);
    line('Politica: '+record.proof.thresholds.version);
    line('Desafio: '+(record.proof.challenge?.Type||'nao retornado')+' | Versao: '+(record.proof.challenge?.Version||'nao retornada'));
    line('Operador autenticado: '+record.operatorId);
    line('Aviso aceito: '+record.noticeVersion);
    hash('SHA-256 da imagem conservada em acesso restrito:',record.referenceHash);
  }
  y-=7;line('Documento gerado no piloto. Nao utiliza o certificado A1 da empresa, nao altera estoque e nao envia documentos ao V10. Os limiares ainda precisam de calibracao com testes reais.');
  line('Disponibilidade no piloto ate: '+new Date(record.expiresAtEpoch*1000).toLocaleString('pt-BR',{timeZone:'America/Campo_Grande'})+' (UTC-04:00).');
  return Buffer.from(await pdf.save());
}
