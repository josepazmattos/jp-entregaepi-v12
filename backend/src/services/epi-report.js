import {readFileSync, statSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {httpError} from '../middleware/auth.js';
import {listEquipmentCatalog} from './epis.service.js';

const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
const compare=new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true});
const unavailable=()=>httpError(503,'O catálogo do relatório está indisponível. Os cadastros manuais continuam disponíveis.','EPI_RELATORIO_INDISPONIVEL');
export function createReportCatalog({filePath=process.env.EPI_REPORT_PATH||new URL('../data/epi-report/manifest.json',import.meta.url)}={}){
  const folder=dirname(filePath instanceof URL?fileURLToPath(filePath):filePath);
  const required=process.env.EPI_REPORT_REQUIRED==='true'||existsSync(filePath);
  let manifest, records, byId, failure=false;
  const details=new Map();
  function load(){
    if(failure)throw unavailable();
    if(records)return;
    try{
      const bytes=readFileSync(filePath);if(bytes.length>128000)throw Error();
      manifest=JSON.parse(bytes);
      if(manifest.schemaVersion!==1||manifest.sourceKind!=='uploaded-relatorio-ca'||!/^relatorio-[a-f0-9]{12}-$/.test(manifest.idPrefix))throw Error();
      const items=read(manifest.index,32*1024*1024);
      if(!Array.isArray(items)||items.length!==manifest.total||items.length>100000)throw Error();
      byId=new Map();
      records=items.map(item=>{
        if(!/^[1-9]\d{0,7}$/.test(item.ca)||!item.nomeCurto||typeof item.ambiguous!=='boolean')throw Error();
        const record={...item,id:manifest.idPrefix+item.ca,tipo:'epi_ca',semCA:false,tamanho:'',catalogoCompartilhado:true,origemCadastro:'relatorio_ca'};
        if(byId.has(record.id))throw Error();byId.set(record.id,record);return record;
      }).sort((a,b)=>compare.compare(a.nomeCurto,b.nomeCurto)||compare.compare(a.ca,b.ca));
      for(const record of records)record.search=fold([record.nomeCurto,record.ca,record.fabricante,record.modelo].join(' '));
    }catch{failure=true;records=null;throw unavailable();}
  }
  function read(descriptor,maxOutputLength){
    if(!descriptor||! /^(?:index|details-\d+)\.json\.gz$/.test(descriptor.file)||! /^[a-f0-9]{64}$/.test(descriptor.sha256))throw Error();
    const file=join(folder,descriptor.file);if(statSync(file).size>8*1024*1024)throw Error();
    const bytes=readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==descriptor.sha256)throw Error();
    return JSON.parse(gunzipSync(bytes,{maxOutputLength}).toString('utf8'));
  }
  function publicItem(item){const {search,...visible}=item;return visible;}
  function metadata(){load();return {total:manifest.total,ambiguousTotal:manifest.ambiguousTotal,sourceDate:manifest.sourceDate,sourceFile:manifest.sourceFile};}
  function summary(manual){
    try{load();const existing=listEquipmentCatalog(manual),cas=new Set(existing.map(e=>e.ca).filter(ca=>byId.has(manifest.idPrefix+ca)));
      return {...metadata(),available:true,total:records.length-cas.size+existing.length,reportTotal:records.length,registeredTotal:existing.length};
    }catch{return {available:false,total:listEquipmentCatalog(manual).length,reportTotal:0,registeredTotal:manual.length};}
  }
  function search(manual,{q='',page='1',origin='all',status='all'}={}){
    if(typeof q!=='string'||q.length>160||!/^\d{1,6}$/.test(String(page))||Number(page)<1||!['all','registered','report','without-ca'].includes(origin)||!['all','valido','vencido','cancelado','suspenso','conferir dados'].includes(status))throw httpError(400,'Filtros do catálogo inválidos.','EPI_CATALOGO_FILTRO');
    const existing=listEquipmentCatalog(manual),cas=new Set(existing.map(e=>e.ca).filter(Boolean));
    let imported=[];
    if(origin==='all'||origin==='report'){load();imported=records.filter(item=>!cas.has(item.ca));}
    const candidates=[...(origin==='report'?[]:existing.map(item=>({...item,origemCadastro:'cadastrado',ambiguous:false}))),...imported];
    const term=fold(q),caQuery=/^(?:ca\s*)?[\d.\s-]+$/i.test(term)?term.replace(/\D/g,'').replace(/^0+/,''):'';
    const tokens=term.split(/\s+/).filter(Boolean);
    const filtered=candidates.filter(item=>(origin!=='without-ca'||item.semCA)&&(status==='all'||fold(item.situacao)===status)&&(!term||(caQuery?item.ca===caQuery:tokens.every(t=>(item.search||fold([item.nomeCurto,item.ca,item.fabricante,item.modelo,item.tamanho].join(' '))).includes(t)))));
    filtered.sort((a,b)=>compare.compare(a.nomeCurto,b.nomeCurto)||compare.compare(a.ca,b.ca)||compare.compare(a.id,b.id));
    const pages=Math.max(1,Math.ceil(filtered.length/15)),current=Math.min(Number(page),pages);
    return {items:filtered.slice((current-1)*15,current*15).map(item=>{const {descricao,name,...short}=publicItem(item);return short;}),page:current,pages,total:filtered.length,pageSize:15,source:metadataSafe()};
  }
  function metadataSafe(){try{return metadata();}catch{return null;}}
  function get(id,{allowAmbiguous=false}={}){
    if(typeof id!=='string'||!/^relatorio-[a-f0-9]{12}-[1-9]\d{0,7}$/.test(id))return null;
    load();const item=byId.get(id);if(!item)return null;
    if(item.ambiguous&&!allowAmbiguous)throw httpError(409,'Este CA tem dados divergentes no relatório. Confira os dados e utilize o cadastro manual.','EPI_RELATORIO_DIVERGENTE');
    const bucket=String(Math.floor(Number(item.ca)/1000));
    if(!details.has(bucket))try{const part=read(manifest.shards.find(x=>x.bucket===bucket),8*1024*1024);details.set(bucket,part);while(details.size>4)details.delete(details.keys().next().value);}catch{throw unavailable();}
    const detail=details.get(bucket)?.[item.ca];if(!detail)throw unavailable();
    return {...publicItem(item),descricao:detail.descricao||item.nomeCurto,...(detail.variants?{variants:detail.variants}:{})};
  }
  function byCA(ca){
    // An installation without the optional report retains manual registration.
    // Once installed, an invalid report must never bypass duplicate protection.
    if(!required&&!existsSync(filePath))return null;
    load();
    const item=byId.get(manifest.idPrefix+ca);return item&&!item.ambiguous?get(item.id):null;
  }
  return {summary,search,get,metadata,byCA};
}
export const reportCatalog=createReportCatalog();
