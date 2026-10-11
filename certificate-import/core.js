import forge from 'node-forge';
import {aeskwp} from '@noble/ciphers/aes.js';

forge.asn1.maxDepth=48;
const bytes=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
const binary=a=>{let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return s;};
const b64=a=>forge.util.encode64(binary(a));
const un64=s=>{if(typeof s!=='string'||s.length>30000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw Error('Resposta de instalação inválida. Reinicie a instalação.');return bytes(forge.util.decode64(s));};
const der=node=>bytes(forge.asn1.toDer(node).getBytes());
const reject=message=>{throw Error(message);};

// Runs exclusively in a short-lived dedicated worker. The original PFX,
// password and clear private key are never returned to the application/API.
export async function openA1(data,password,expectedCompany){
  if(!(data instanceof ArrayBuffer)||!data.byteLength||data.byteLength>1024*1024)reject('Escolha um arquivo A1 .pfx ou .p12 de até 1 MB.');
  if(typeof password!=='string'||password.length>1024)reject('Informe a senha do arquivo A1.');
  if(typeof expectedCompany!=='string'||!expectedCompany)reject('Selecione a empresa antes de instalar.');
  let pfx;
  try{pfx=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(binary(new Uint8Array(data)),{strict:true,maxDepth:48}),true,password);}
  catch{reject('Não foi possível abrir o A1. Confira a senha e selecione o arquivo .pfx ou .p12 original.');}
  finally{new Uint8Array(data).fill(0);password='';}
  const bags=pfx.safeContents.flatMap(s=>s.safeBags),keys=bags.filter(b=>b.key),certs=bags.filter(b=>b.cert).map(b=>b.cert);
  if(keys.length!==1)reject('O arquivo deve conter um único certificado A1 com sua chave privada. Exporte somente o A1 desejado.');
  const key=keys[0].key;
  if(!key.n||!key.e||![2048,3072,4096].includes(key.n.bitLength()))reject('Use um A1 RSA de 2048, 3072 ou 4096 bits.');
  const matching=certs.filter(c=>c.publicKey.n?.equals(key.n)&&c.publicKey.e?.equals(key.e)&&!c.getExtension('basicConstraints')?.cA);
  if(matching.length!==1)reject('Não foi encontrado um único certificado correspondente à chave privada. Exporte novamente o A1 com sua cadeia.');
  const leaf=matching[0],now=new Date();
  if(leaf.validity.notAfter<=now)reject('Este certificado venceu. Selecione o A1 renovado.');
  if(leaf.validity.notBefore>now)reject('Este certificado ainda não está válido. Confira a data do computador.');
  const chain=[leaf,...certs.filter(c=>c!==leaf&&c.getExtension('basicConstraints')?.cA)].map(c=>b64(der(forge.pki.certificateToAsn1(c))));
  if(chain.length>8)reject('A cadeia do certificado contém mais de oito certificados. Exporte somente o A1 desejado.');
  let privateBytes=der(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)));
  const signingKey=await crypto.subtle.importKey('pkcs8',privateBytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  let proved=false,wrapped=false;
  return {
    info:{chain,subject:leaf.subject.attributes.map(a=>`${a.shortName||a.name}=${a.value}`).join(' · '),validTo:leaf.validity.notAfter.toISOString()},
    async prove(configuration){
      if(proved)reject('A autorização já foi usada. Reinicie a instalação.');
      const content=un64(configuration.contentBase64),attrs=un64(configuration.signingBase64);
      let packet;try{packet=JSON.parse(new TextDecoder().decode(content));}catch{reject('Autorização do cofre inválida.');}
      if(packet.schema!=='JPGED-COFRE-1'||packet.companyId!==expectedCompany||packet.id!==configuration.id||packet.expires<=Date.now()/1000||packet.expires>Date.now()/1000+600||packet.scope!=='Autorizar exclusivamente a certificação das fichas de EPI desta empresa confirmadas biometricamente')reject('A empresa ou a autorização mudou. Feche esta janela e inicie novamente.');
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',content));
      const node=forge.asn1.fromDer(binary(attrs),{strict:true,maxDepth:12});
      const digests=node.value?.filter(a=>forge.asn1.derToOid(a.value?.[0]?.value||'')==='1.2.840.113549.1.9.4');
      if(node.type!==forge.asn1.Type.SET||digests?.length!==1||digests[0].value?.[1]?.value?.[0]?.value!==binary(digest))reject('A autorização do cofre perdeu a integridade. Reinicie a instalação.');
      proved=true;return {signature:b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signingKey,attrs)))};
    },
    async wrap(wrappingKey){
      if(!proved||wrapped)reject('Reinicie a instalação para proteger o certificado.');
      wrapped=true;const aes=crypto.getRandomValues(new Uint8Array(32));
      try{
        const publicKey=await crypto.subtle.importKey('spki',un64(wrappingKey),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
        if(publicKey.algorithm.modulusLength!==4096)reject('A chave de proteção do cofre não é compatível.');
        const encryptedAes=new Uint8Array(await crypto.subtle.encrypt('RSA-OAEP',publicKey,aes)),encryptedPrivate=aeskwp(aes).encrypt(privateBytes),combined=new Uint8Array(encryptedAes.length+encryptedPrivate.length);
        combined.set(encryptedAes);combined.set(encryptedPrivate,encryptedAes.length);
        return {wrappedKey:b64(combined)};
      }finally{aes.fill(0);privateBytes.fill(0);privateBytes=null;}
    },
    dispose(){privateBytes?.fill(0);privateBytes=null;}
  };
}
