const KEY='jp-facial-pilot-auth';
const production='https://g4pdu3t1va.execute-api.sa-east-1.amazonaws.com';
const clientId='2q2inha617oeer4vb0m0hjoja0';
export function auth(){try{const a=JSON.parse(sessionStorage.getItem(KEY));return a?.expiresAt>Date.now()?a:null;}catch{return null;}}
export function logout(){sessionStorage.removeItem(KEY);}
export function saveAuthentication(result,username){
  if(!result?.IdToken)throw Error('O acesso não foi concluído.');
  sessionStorage.setItem(KEY,JSON.stringify({idToken:result.IdToken,expiresAt:Date.now()+result.ExpiresIn*1000,username}));
}
async function json(url,body,headers={}){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});const v=await r.json();
  if(!r.ok||v.ok===false)throw Error(v.error||v.message||'Confira os dados de acesso.');return v;
}
export async function login(username,password){
  const resolved=await json(production+'/auth/resolver',{login:username});
  const response=await json('https://cognito-idp.sa-east-1.amazonaws.com/',{ClientId:clientId,AuthFlow:'USER_PASSWORD_AUTH',AuthParameters:{USERNAME:resolved.username,PASSWORD:password}},{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'AWSCognitoIdentityProviderService.InitiateAuth'});
  if(response.ChallengeName==='NEW_PASSWORD_REQUIRED')throw Error('Conclua o primeiro acesso no aplicativo EntregaEPI e retorne ao teste.');
  if(response.AuthenticationResult){saveAuthentication(response.AuthenticationResult,username);return null;}
  if(!['SOFTWARE_TOKEN_MFA','EMAIL_OTP'].includes(response.ChallengeName))throw Error('Conclua o acesso Master no aplicativo principal.');
  return {username:response.ChallengeParameters?.USER_ID_FOR_SRP||response.ChallengeParameters?.USERNAME||resolved.username,session:response.Session,challengeName:response.ChallengeName};
}
export async function finishMfa(challenge,code){
  const r=await json(production+'/auth/mfa',{...challenge,code});saveAuthentication(r.AuthenticationResult,challenge.username);
}
