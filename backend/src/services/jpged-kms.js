import {KMSClient,CreateKeyCommand,GetParametersForImportCommand,ImportKeyMaterialCommand,GetPublicKeyCommand,SignCommand,ScheduleKeyDeletionCommand,DescribeKeyCommand} from '@aws-sdk/client-kms';
import {createHash} from 'node:crypto';
import {httpError} from '../middleware/auth.js';
const region=process.env.AWS_REGION||'sa-east-1';
const client=new KMSClient({region,maxAttempts:1});
export function createKeyVault(kms=client){
  const account=process.env.JPGED_KMS_ACCOUNT||'003020057405';
  const policy=()=>{
    const signer=process.env.SIGNER_ROLE_ARN,admin=process.env.VAULT_ADMIN_ROLE_ARN;
    if(!signer||!admin)throw httpError(503,'As permissões do cofre não estão configuradas.','COFRE_PERMISSOES');
    return JSON.stringify({Version:'2012-10-17',Statement:[
      {Sid:'AccountAdministration',Effect:'Allow',Principal:{AWS:'arn:aws:iam::'+account+':root'},Action:'kms:*',Resource:'*'},
      {Sid:'IsolatedSigner',Effect:'Allow',Principal:{AWS:signer},Action:['kms:Sign','kms:DescribeKey'],Resource:'*'},
      {Sid:'IsolatedVaultAdministration',Effect:'Allow',Principal:{AWS:admin},Action:['kms:GetParametersForImport','kms:ImportKeyMaterial','kms:GetPublicKey','kms:DescribeKey','kms:ScheduleKeyDeletion'],Resource:'*'}
    ]});
  };
  const key=arn=>{if(!new RegExp('^arn:aws:kms:'+region+':[0-9]{12}:key/[a-f0-9-]{36}$').test(arn))throw httpError(409,'Chave do cofre inválida.','COFRE_CHAVE');return arn;};
  return {
    async create(company,id,bits){
      if(![2048,3072,4096].includes(bits))throw httpError(422,'Use um A1 RSA de 2048, 3072 ou 4096 bits.','COFRE_TIPO');
      // The account retains administration. The application intentionally cannot
      // change key policies; it receives operations on each newly created key only.
      // CreateKey is deliberately not retried: it has no idempotency token.
      const r=await kms.send(new CreateKeyCommand({Origin:'EXTERNAL',KeyUsage:'SIGN_VERIFY',KeySpec:'RSA_'+bits,Description:'JPGED|'+company+'|'+id,Policy:policy(),BypassPolicyLockoutSafetyCheck:true}));return key(r.KeyMetadata.Arn);
    },
    async parameters(arn){const r=await kms.send(new GetParametersForImportCommand({KeyId:key(arn),WrappingAlgorithm:'RSA_AES_KEY_WRAP_SHA_256',WrappingKeySpec:'RSA_4096'}));return {wrappingKey:Buffer.from(r.PublicKey).toString('base64'),importToken:Buffer.from(r.ImportToken).toString('base64')};},
    async import(arn,wrapped,token,validTo){await kms.send(new ImportKeyMaterialCommand({KeyId:key(arn),EncryptedKeyMaterial:wrapped,ImportToken:Buffer.from(token,'base64'),ExpirationModel:'KEY_MATERIAL_EXPIRES',ValidTo:new Date(validTo)}));const r=await kms.send(new GetPublicKeyCommand({KeyId:key(arn)}));return Buffer.from(r.PublicKey);},
    async sign(arn,bytes){const r=await kms.send(new SignCommand({KeyId:key(arn),Message:createHash('sha256').update(bytes).digest(),MessageType:'DIGEST',SigningAlgorithm:'RSASSA_PKCS1_V1_5_SHA_256'}));return Buffer.from(r.Signature);},
    async retire(arn){try{await kms.send(new ScheduleKeyDeletionCommand({KeyId:key(arn),PendingWindowInDays:7}));}catch(e){if(e.name!=='KMSInvalidStateException')throw e;}},
    async status(arn){const r=await kms.send(new DescribeKeyCommand({KeyId:key(arn)}));return r.KeyMetadata.KeyState;}
  };
}
export const keyVault=createKeyVault();
