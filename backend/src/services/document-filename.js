// Download metadata only: never rewrite an already certified PDF.
export function documentFilename(item) {
  const date=String(item.data||'');
  const br=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date),iso=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(date);
  const stamp=br?`${br[1]}-${br[2]}-${br[3]}`:iso?`${iso[3]}-${iso[2]}-${iso[1]}`:'Sem-data';
  const source=String(item.trabalhadorNome||'Trabalhador').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g,' ').replace(/\s+/g,' ').trim();
  let name='';
  for(const c of source){if(Buffer.byteLength(name+c,'utf8')>180)break;name+=c;}
  name=name.replace(/[ .]+$/,'')||'Trabalhador';
  return `Ficha-EPI-${stamp} - ${name}.pdf`;
}
export function attachmentDisposition(filename) {
  const safe=String(filename).replace(/[\u0000-\u001f\u007f-\u009f"\\/]/g,'_');
  const ascii=safe.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^a-zA-Z0-9 ._-]/g,'_');
  const encoded=encodeURIComponent(safe).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
