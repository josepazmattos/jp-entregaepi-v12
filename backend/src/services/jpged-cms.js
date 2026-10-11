import {X509Certificate,createHash} from 'node:crypto';
import * as asn1 from 'asn1js';
import * as pki from 'pkijs';
import {httpError} from '../middleware/auth.js';
const sha=bytes=>createHash('sha256').update(bytes).digest();
const der=node=>Buffer.from(node.toBER(false));
export function publicChain(input){
  try{
    if(!Array.isArray(input)||!input.length||input.length>8)throw Error();
    return input.map(value=>{
      if(typeof value!=='string'||value.length>16000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error();
      const bytes=Buffer.from(value,'base64'),cert=new X509Certificate(bytes);
      if(!cert.raw.equals(bytes))throw Error();return cert;
    });
  }catch{throw httpError(400,'A cadeia pública do certificado não é válida.','COFRE_CADEIA');}
}
// Only public certificates and signed attributes are handled here. Private keys
// remain local during import and in KMS during document signing.
export function detachedCms(content,chain,time=new Date()){
  const nodes=publicChain(chain).map(c=>new pki.Certificate({schema:asn1.fromBER(c.raw).result}));
  const leaf=nodes[0],algorithm=new pki.AlgorithmIdentifier({algorithmId:'2.16.840.1.101.3.4.2.1'});
  const attrs=new pki.SignedAndUnsignedAttributes({type:0,attributes:[
    new pki.Attribute({type:'1.2.840.113549.1.9.3',values:[new asn1.ObjectIdentifier({value:'1.2.840.113549.1.7.1'})]}),
    new pki.Attribute({type:'1.2.840.113549.1.9.5',values:[new asn1.UTCTime({valueDate:time})]}),
    new pki.Attribute({type:'1.2.840.113549.1.9.4',values:[new asn1.OctetString({valueHex:sha(content)})]}),
    new pki.Attribute({type:'1.2.840.113549.1.9.16.2.47',values:[new asn1.Sequence({value:[new asn1.Sequence({value:[new asn1.Sequence({value:[new asn1.OctetString({valueHex:sha(publicChain(chain)[0].raw)})]})]})]})]})
  ]});
  // DER SET OF ordering is part of the signature, not caller-controlled order.
  attrs.attributes.sort((a,b)=>Buffer.compare(der(a.toSchema()),der(b.toSchema())));
  const signedBytes=der(attrs.toSchema());signedBytes[0]=0x31;
  const signer=new pki.SignerInfo({version:1,sid:new pki.IssuerAndSerialNumber({issuer:leaf.issuer,serialNumber:leaf.serialNumber}),digestAlgorithm:algorithm,signedAttrs:attrs,signatureAlgorithm:new pki.AlgorithmIdentifier({algorithmId:'1.2.840.113549.1.1.11',algorithmParams:new asn1.Null()})});
  return {signedBytes,complete(signature){
    signer.signature=new asn1.OctetString({valueHex:signature});
    const signed=new pki.SignedData({version:1,digestAlgorithms:[algorithm],encapContentInfo:new pki.EncapsulatedContentInfo({eContentType:'1.2.840.113549.1.7.1'}),certificates:nodes,signerInfos:[signer]});
    return der(new pki.ContentInfo({contentType:'1.2.840.113549.1.7.2',content:signed.toSchema(true)}).toSchema());
  }};
}
