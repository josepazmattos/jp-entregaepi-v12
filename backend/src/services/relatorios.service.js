import { equipmentCaLabel } from './equipment-classification.js';
import { httpError } from '../middleware/auth.js';
import { textField } from '../routes/_helpers.js';
import { workerDate } from './trabalhadores.service.js';
export const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
export const STATUS={pendente:'Não assinada',legado:'Assinatura antiga sem conferência',biometria:'Biometria confirmada · Certificação pendente',certificada:'Documento certificado',cancelada:'Cancelada'};
export function statusFicha(f){return f.status==='cancelada'?'cancelada':f.status!=='assinada'?'pendente':f.assinaturaBiometrica?.verificada!==true?'legado':f.certificacao?.status==='certificado'?'certificada':'biometria';}
export function reportFilters(input={}){
  const out={};for(const key of ['trabalhadorId','busca','funcao','setor','equipamento','ca','fabricante','numero','tipo','situacao','statusTrabalhador','inicio','fim'])out[key]=textField(input[key],{field:key,max:300});
  for(const key of ['inicio','fim'])if(out[key]){const date=workerDate(out[key]);if(!date)throw httpError(400,'Período inválido.');out[key]=date;}
  if(out.inicio&&out.fim&&out.inicio>out.fim)throw httpError(400,'A data inicial deve ser anterior à final.');
  if(out.tipo&&!['Entrega','Troca','Devolução'].includes(out.tipo)||out.situacao&&!STATUS[out.situacao]||out.statusTrabalhador&&!['Ativo','Inativo'].includes(out.statusTrabalhador))throw httpError(400,'Filtro inválido.');
  out.canceladas=input.canceladas===true||input.canceladas==='true';out.pendencias=input.pendencias===true||input.pendencias==='true';return out;
}
export function buildReport({empresa,workers,fichas,filters={},actor='',now=new Date().toISOString()}){
  const f=reportFilters(filters),workerMap=new Map(workers.map(w=>[w.id,w]));
  const rows=[],duplicate=new Map();
  for(const ficha of fichas){
    if(ficha.empresaId!==empresa.id)throw httpError(403,'Ficha de outra empresa.');
    const worker=workerMap.get(ficha.trabalhadorId)||{},snap=ficha.trabalhadorSnapshot||{};
    const situation=statusFicha(ficha);
    for(const [index,item] of (ficha.itens||[]).entries()){
      const tipo=item.tipoMovimentacao||ficha.tipo||'Entrega';
      const rawDate=(tipo==='Devolução'?item.datasMovimentacao?.devolucao:item.datasMovimentacao?.entrega)||item.data||ficha.data||'';
      const date=workerDate(rawDate)||'';
      const row={id:`${ficha.id}:${index}`,fichaId:ficha.id,numero:ficha.numero||ficha.id,trabalhadorId:ficha.trabalhadorId,empresa:ficha.empresaSnapshot?.nome||empresa.nome,cnpj:ficha.empresaSnapshot?.cnpj||empresa.cnpj,endereco:ficha.empresaSnapshot?.endereco||'',nome:snap.nomeCompleto||ficha.trabalhadorNome||'',cpf:snap.cpf||ficha.cpf||'',matricula:snap.matriculaESocial||ficha.matriculaESocial||'',funcao:snap.funcao||ficha.funcao||'',setor:snap.setor||'',admissao:snap.dataAdmissao||'',statusTrabalhador:worker.status||'Não informado',epiId:item.epiId||'',equipamento:item.epiNome||item.epiDescricao||'',ca:equipmentCaLabel(item)||'',fabricante:item.fabricante||'',modelo:item.modelo||'',tamanho:item.tamanho||'',quantidade:Number(item.quantidade)||0,tipo,data:rawDate,date,situacao:situation,situacaoTexto:STATUS[situation],criadoPor:ficha.criadoPor||'',criadoEm:ficha.createdAt||'',assinaturaMetodo:ficha.assinaturaBiometrica?.verificada===true?(ficha.assinaturaBiometrica.metodo==='AWS_REKOGNITION_FACE_LIVENESS'?'Biometria facial':'Biometria digital'):'Não verificada',assinadaEm:ficha.assinaturaBiometrica?.signedAt||'',certificadaEm:ficha.certificacao?.certifiedAt||'',documentId:ficha.certificacao?.documentId||'',orientacao:ficha.orientacao?.confirmada?`Registrada em ${ficha.orientacao.data} por ${ficha.orientacao.responsavel}${ficha.orientacao.referencia?' · Referência: '+ficha.orientacao.referencia:''}`:'Não informada',relacao:ficha.kitSnapshot?.nome||'',pendencias:[]};
      if(situation==='pendente')row.pendencias.push('Ficha sem assinatura');
      if(situation==='legado')row.pendencias.push('Registro antigo sem conferência biométrica');
      if(situation==='biometria')row.pendencias.push('Certificação pendente');
      if(situation==='certificada'&&!row.documentId)row.pendencias.push('Original não vinculado');
      if(!row.nome||!row.cpf||!row.matricula||!row.equipamento||!row.ca||!date)row.pendencias.push('Dados históricos incompletos');
      const key=JSON.stringify([row.trabalhadorId,date,row.epiId||row.equipamento,row.tipo,row.quantidade,row.tamanho]);
      if(!duplicate.has(key))duplicate.set(key,[]);duplicate.get(key).push(row);
      rows.push(row);
    }
  }
  for(const group of duplicate.values())if(new Set(group.filter(r=>r.situacao!=='cancelada').map(r=>r.fichaId)).size>1)for(const row of group)if(row.situacao!=='cancelada')row.pendencias.push('Possível duplicidade: conferir fichas');
  const match=(value,query)=>!query||fold(value).includes(fold(query));
  const workerMatch=(r,query)=>match([r.nome,r.cpf,r.matricula].join(' '),query)||/^[\d.\- ]+$/.test(query)&&String(r.cpf).replace(/\D/g,'').includes(query.replace(/\D/g,''));
  const filtered=rows.filter(r=>(!f.trabalhadorId||r.trabalhadorId===f.trabalhadorId)&&(!f.inicio||r.date&&r.date>=f.inicio)&&(!f.fim||r.date&&r.date<=f.fim)&&(!f.situacao||r.situacao===f.situacao)&&(f.canceladas||f.situacao==='cancelada'||r.situacao!=='cancelada')&&(!f.tipo||r.tipo===f.tipo)&&(!f.statusTrabalhador||r.statusTrabalhador===f.statusTrabalhador)&&(!f.pendencias||r.pendencias.length)&&workerMatch(r,f.busca)&&['funcao','setor','equipamento','ca','fabricante','numero'].every(k=>match(r[k],f[k]))).sort((a,b)=>b.date.localeCompare(a.date)||a.nome.localeCompare(b.nome,'pt-BR')||a.fichaId.localeCompare(b.fichaId)||a.id.localeCompare(b.id));
  const unique=[...new Map(filtered.map(r=>[r.fichaId,r])).values()],valid=filtered.filter(r=>r.situacao!=='cancelada');
  const summary={fichas:unique.length,trabalhadores:new Set(filtered.map(r=>r.trabalhadorId)).size,itens:filtered.length,entregas:0,trocas:0,devolucoes:0,pendentes:unique.filter(r=>r.situacao==='pendente').length,certificadas:unique.filter(r=>r.situacao==='certificada').length,canceladas:unique.filter(r=>r.situacao==='cancelada').length};
  for(const row of valid){const key={Entrega:'entregas',Troca:'trocas','Devolução':'devolucoes'}[row.tipo];if(key)summary[key]+=row.quantidade;}
  const workerSummary=[...new Set(filtered.map(r=>r.trabalhadorId))].map(id=>{const list=filtered.filter(r=>r.trabalhadorId===id);return {trabalhadorId:id,nome:list[0].nome,matricula:list[0].matricula,fichas:new Set(list.map(r=>r.fichaId)).size,ultimaMovimentacao:list[0].data,pendencias:new Set(list.filter(r=>r.pendencias.length).map(r=>r.fichaId)).size};});
  // Absence applies to the period, not to equipment/status filters or actual receipt.
  const periodWorkers=new Set(rows.filter(r=>r.situacao!=='cancelada'&&(!f.inicio||r.date&&r.date>=f.inicio)&&(!f.fim||r.date&&r.date<=f.fim)).map(r=>r.trabalhadorId));
  const semMovimentacao=workers.filter(w=>(!f.trabalhadorId||w.id===f.trabalhadorId)&&(!f.statusTrabalhador||w.status===f.statusTrabalhador)&&match(w.funcao,f.funcao)&&match(w.setor,f.setor)&&workerMatch({nome:w.nomeCompleto||w.nome,cpf:w.cpf,matricula:w.matriculaESocial},f.busca)&&!periodWorkers.has(w.id)).map(w=>({id:w.id,nome:w.nomeCompleto||w.nome,matricula:w.matriculaESocial,status:w.status||'Não informado'}));
  return {empresa:{id:empresa.id,nome:empresa.nome,cnpj:empresa.cnpj,endereco:empresa.endereco||'',localidade:empresa.localidade,uf:empresa.uf},filters:f,geradoEm:now,geradoPor:actor,summary,workers:workerSummary,semMovimentacao,rows:filtered};
}
