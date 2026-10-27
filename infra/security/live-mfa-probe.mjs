// Deployment verification only. Never included in the production API handler.
// Credentials and authenticator seed are generated in memory and never returned.
import {randomBytes,createHmac,createHash} from 'node:crypto';
import {CognitoIdentityProviderClient,AdminCreateUserCommand,AdminSetUserPasswordCommand,AdminDeleteUserCommand,InitiateAuthCommand,AssociateSoftwareTokenCommand,VerifySoftwareTokenCommand,SetUserMFAPreferenceCommand} from '@aws-sdk/client-cognito-identity-provider';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {DynamoDBClient,GetItemCommand} from '@aws-sdk/client-dynamodb';
const cognito=new CognitoIdentityProviderClient({maxAttempts:1}),lambda=new LambdaClient({maxAttempts:1}),db=new DynamoDBClient({maxAttempts:1});
function code(seed){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of seed)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');const bytes=Buffer.from((bits.match(/.{8}/g)||[]).map(x=>parseInt(x,2)));const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac('sha1',bytes).update(b).digest(),offset=hash.at(-1)&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
export async function handler(){
 const pool=process.env.COGNITO_USER_POOL_ID,client=process.env.COGNITO_CLIENT_ID,username='security-validation-'+randomBytes(12).toString('hex'),password=randomBytes(32).toString('base64url')+'aA1!';let created=false;const checks=[];
 const invoke=async(name,payload)=>{const r=await lambda.send(new InvokeCommand({FunctionName:name,Payload:Buffer.from(JSON.stringify(payload))}));if(r.FunctionError)throw new Error('REMOTE_FUNCTION');return JSON.parse(Buffer.from(r.Payload));};
 const login=()=>cognito.send(new InitiateAuthCommand({ClientId:client,AuthFlow:'USER_PASSWORD_AUTH',AuthParameters:{USERNAME:username,PASSWORD:password}}));
 try{
  await cognito.send(new AdminCreateUserCommand({UserPoolId:pool,Username:username,TemporaryPassword:password,MessageAction:'SUPPRESS'}));created=true;await cognito.send(new AdminSetUserPasswordCommand({UserPoolId:pool,Username:username,Password:password,Permanent:true}));
  const initial=await login();if(!initial.AuthenticationResult?.AccessToken)throw new Error('INITIAL_LOGIN');
  const setup=await cognito.send(new AssociateSoftwareTokenCommand({AccessToken:initial.AuthenticationResult.AccessToken}));
  const paired=await cognito.send(new VerifySoftwareTokenCommand({AccessToken:initial.AuthenticationResult.AccessToken,UserCode:code(setup.SecretCode),FriendlyDeviceName:'Temporary automated security validation'}));if(paired.Status!=='SUCCESS')throw new Error('PAIRING');
  await cognito.send(new SetUserMFAPreferenceCommand({AccessToken:initial.AuthenticationResult.AccessToken,SoftwareTokenMfaSettings:{Enabled:true,PreferredMfa:true}}));checks.push('totp-enrollment');
  const challenge=await login();if(challenge.ChallengeName!=='SOFTWARE_TOKEN_MFA'||challenge.AuthenticationResult)throw new Error('PASSWORD_BYPASS');checks.push('password-only-blocked');
  const invalid=await invoke('jp-entregaepi-auth-security',{action:'challenge',username,session:challenge.Session,code:'abcdef'});if(invalid.ok)throw new Error('INVALID_ACCEPTED');checks.push('invalid-code-rejected');
  // Avoid relying on provider-specific reuse of a code used for enrollment.
  await new Promise(r=>setTimeout(r,31000-Date.now()%30000));
  const fresh=await login(),auth=await invoke('jp-entregaepi-auth-security',{action:'challenge',username,session:fresh.Session,code:code(setup.SecretCode)});
  if(!auth.ok||!auth.data?.AuthenticationResult?.IdToken)throw new Error('MFA_AUTH_'+(auth.code||'FAILED'));
  const token=auth.data.AuthenticationResult.IdToken,hash=createHash('sha256').update(token).digest('hex');
  const record=await db.send(new GetItemCommand({TableName:process.env.SECURITY_TABLE,Key:{pk:{S:'MFA#'+hash}},ConsistentRead:true}));if(record.Item?.kind?.S!=='mfa')throw new Error('PROOF_NOT_SAVED');checks.push('cognito-token-verified-and-bound-proof-saved');
  const signer=await invoke('jp-entregaepi-signer',{action:'certificate',company:'synthetic-company',token});if(signer.ok||signer.status!==403)throw new Error('UNSCOPED_SIGNER');checks.push('signer-refuses-unassigned-account');
  const admin=await invoke('jp-entregaepi-vault-admin',{action:'start',company:'synthetic-company',token,body:{chain:[]}});if(admin.ok||admin.status!==403)throw new Error('UNSCOPED_ADMIN');checks.push('vault-refuses-non-master');
  return {passed:true,checks,temporaryUserDeletedOnExit:true};
 }catch(e){return {passed:false,step:e.message?.startsWith('MFA_AUTH_')?e.message:e.name==='Error'?e.message:e.name,checks};}
 finally{if(created)await cognito.send(new AdminDeleteUserCommand({UserPoolId:pool,Username:username}));}
}
