import {createHash} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {RekognitionClient,CreateFaceLivenessSessionCommand,GetFaceLivenessSessionResultsCommand,DetectFacesCommand,CompareFacesCommand} from '@aws-sdk/client-rekognition';
import {STSClient,AssumeRoleCommand} from '@aws-sdk/client-sts';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {KMSClient,SignCommand} from '@aws-sdk/client-kms';
const options={region:'sa-east-1',maxAttempts:2};
const db=DynamoDBDocumentClient.from(new DynamoDBClient(options)),rek=new RekognitionClient(options),sts=new STSClient(options),s3=new S3Client(options),kms=new KMSClient(options);
const digest=value=>createHash('sha256').update(value).digest();
const failure=(code,message)=>Object.assign(new Error(message),{status:429,statusCode:429,code});
export const provider={
 async reserveQuota(actor,id){
  const table=process.env.FACIAL_QUOTA_TABLE,key={pk:'INTEGRATED#'+id,sk:'RESERVATION'},day=new Date().toISOString().slice(0,10);
  const get=async()=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
  if(await get())return;
  const counter=(pk,sk,limit)=>({Update:{TableName:table,Key:{pk,sk},UpdateExpression:'SET #n = if_not_exists(#n, :zero) + :one',ConditionExpression:'attribute_not_exists(#n) OR #n < :max',ExpressionAttributeNames:{'#n':'count'},ExpressionAttributeValues:{':zero':0,':one':1,':max':limit}}});
  try{await db.send(new TransactWriteCommand({ClientRequestToken:id.slice(0,36),TransactItems:[{Put:{TableName:table,Item:{...key,actor,day},ConditionExpression:'attribute_not_exists(pk)'}},counter('LIMIT','TOTAL',50),counter('LIMIT#'+actor,day,20)]}));}
  catch(error){if(await get())return;if(error.name==='TransactionCanceledException')throw failure('FACIAL_LIMITE','O limite de capturas desta etapa foi atingido.');throw error;}
 },
 async create({token}){const r=await rek.send(new CreateFaceLivenessSessionCommand({ClientRequestToken:token,Settings:{AuditImagesLimit:0,ChallengePreferences:[{Type:'FaceMovementAndLightChallenge'}]}}));return {sessionId:r.SessionId,requestId:r.$metadata.requestId};},
 async credentials(id){const r=await sts.send(new AssumeRoleCommand({RoleArn:process.env.FACIAL_STREAM_ROLE_ARN,RoleSessionName:'ficha-'+id,DurationSeconds:900}));const c=r.Credentials;if(!c)throw Error('Credenciais temporárias indisponíveis.');return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration.toISOString()};},
 async result(sessionId){const r=await rek.send(new GetFaceLivenessSessionResultsCommand({SessionId:sessionId}));return {status:r.Status,confidence:r.Confidence,image:r.ReferenceImage?.Bytes,challenge:r.Challenge,requestId:r.$metadata.requestId};},
 async countFaces(image){const r=await rek.send(new DetectFacesCommand({Image:{Bytes:image},Attributes:['DEFAULT']}));return r.FaceDetails?.length||0;},
 async compare(source,target){const r=await rek.send(new CompareFacesCommand({SourceImage:{Bytes:source},TargetImage:{Bytes:target},SimilarityThreshold:0,QualityFilter:'NONE'}));return {similarity:r.FaceMatches?.[0]?.Similarity,faceCount:(r.FaceMatches?.length||0)+(r.UnmatchedFaces?.length||0),requestId:r.$metadata.requestId};},
 async putImage(company,id,bytes){const key='private/'+digest(company).toString('hex')+'/'+id+'.jpg';const r=await s3.send(new PutObjectCommand({Bucket:process.env.FACIAL_BUCKET,Key:key,Body:bytes,ContentType:'image/jpeg',ServerSideEncryption:'AES256',IfNoneMatch:'*'}));if(!r.VersionId)throw Error('O armazenamento facial exige versionamento.');return {key,version:r.VersionId};},
 async getImage(key,version){if(!version)throw Error('Versão da evidência ausente.');return (await s3.send(new GetObjectCommand({Bucket:process.env.FACIAL_BUCKET,Key:key,VersionId:version}))).Body.transformToByteArray();},
 async removeImage(key,version){if(!version)throw Error('Versão da evidência ausente.');await s3.send(new DeleteObjectCommand({Bucket:process.env.FACIAL_BUCKET,Key:key,VersionId:version}));},
 async sign(proof){const keyArn=process.env.FACIAL_ATTESTATION_KEY_ARN,publicKey=JSON.parse(process.env.FACIAL_TRUSTED_KEYS||'{}')[keyArn];if(!publicKey)throw Error('Chave facial não configurada.');const r=await kms.send(new SignCommand({KeyId:keyArn,Message:digest(proof),MessageType:'DIGEST',SigningAlgorithm:'ECDSA_SHA_256'}));if(!r.Signature||r.KeyId!==keyArn)throw Error('Selo facial indisponível.');return {proofSignature:Buffer.from(r.Signature).toString('base64'),keyArn,publicKey};}
};
