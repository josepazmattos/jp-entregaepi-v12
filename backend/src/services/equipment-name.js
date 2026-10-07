// Used only as a fallback for old records that predate a separate display name.
export function equipmentName(item = {}) {
  const explicit=String(item.epiNome || item.nomeCurto || item.nome || '').trim();
  if(explicit && explicit.length<=160)return explicit;
  const raw=String(item.epiDescricao || item.descricao || item.description || item.name || 'Equipamento').trim();
  if(raw.length<=160)return raw;
  const generic=raw.match(/^(capacete de seguran[çc]a|[óo]culos de seguran[çc]a|luva[s]? de seguran[çc]a|cal[çc]ado de seguran[çc]a|cintur[ãa]o de seguran[çc]a|protetor auditivo|respirador|talabarte|trava.quedas)\b/i);
  if(generic)return generic[1];
  return raw.split(/[.;\n]/)[0].slice(0,157).replace(/\s+\S*$/, '')+'…';
}
