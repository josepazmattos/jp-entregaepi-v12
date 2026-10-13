import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export function reportFixture({extraRecords=[]}={}){
  const folder=mkdtempSync(join(tmpdir(),'epi-report-')),idPrefix='relatorio-0123456789ab-';
  const records=Array.from({length:40},(_,i)=>({ca:String(100+i),nomeCurto:`ÓCULOS DE PROTEÇÃO ${i}`,fabricante:'FÁBRICA SINTÉTICA',modelo:`Modelo ${i}`,validade:'01/01/2028',situacao:i%2?'VÁLIDO':'VENCIDO',ambiguous:false}));
  records.push({...records[0],ca:'365',nomeCurto:'CAPACETE DO RELATÓRIO'});
  records.push({...records[0],ca:'999',nomeCurto:'Equipamento CA 999',situacao:'Conferir dados',ambiguous:true});
  records.push(...extraRecords.map(item=>({...records[0],...item})));
  const detail=Object.fromEntries(records.map(item=>[item.ca,{descricao:'DESCRIÇÃO TÉCNICA; COM QUEBRA\n'+ 'x'.repeat(2400),...(item.ambiguous?{variants:[{...item,modelo:'A'},{...item,modelo:'B'}]}:{})}]));
  function save(file,value){const bytes=gzipSync(JSON.stringify(value));writeFileSync(join(folder,file),bytes);return {file,sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length};}
  const manifest={schemaVersion:1,sourceKind:'uploaded-relatorio-ca',sourceFile:'RelatorioCA_SINTETICO.csv.gz',sourceDate:'2026-10-11',sourceRows:84,total:records.length,ambiguousTotal:1,idPrefix,index:save('index.json.gz',records),shards:[{bucket:'0',...save('details-0.json.gz',detail)}]};
  const filePath=join(folder,'manifest.json');writeFileSync(filePath,JSON.stringify(manifest));
  return {filePath,folder,manifest,records,id:ca=>idPrefix+ca,cleanup:()=>rmSync(folder,{recursive:true,force:true})};
}
