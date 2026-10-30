import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand, CompareFacesCommand, DetectFacesCommand } from '@aws-sdk/client-rekognition';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { digest, fail } from './service.mjs';

const region = 'sa-east-1';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 2 }), { marshallOptions: { removeUndefinedValues: true } });
const rekognition = new RekognitionClient({ region, maxAttempts: 2 });
const sts = new STSClient({ region, maxAttempts: 2 });
const s3 = new S3Client({ region, maxAttempts: 2 });
const table = process.env.PILOT_TABLE, bucket = process.env.PILOT_BUCKET;
const key = (owner, sk) => ({ pk: 'OWNER#' + owner, sk });
function conditionError(error) {
  if (['ConditionalCheckFailedException','TransactionCanceledException'].includes(error.name)) fail(409, 'CONFLICT_OR_LIMIT', 'A tentativa mudou ou o limite de testes foi atingido. Atualize a lista.');
  throw error;
}
export const store = {
  async get(owner, sk) { return (await db.send(new GetCommand({ TableName: table, Key: key(owner,sk), ConsistentRead: true }))).Item; },
  async list(owner) {
    const items = []; let cursor;
    do {
      const page = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'OWNER#' + owner }, ExclusiveStartKey: cursor, ConsistentRead: true }));
      items.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
    } while (cursor);
    return items;
  },
  async reserve(item,{day,totalLimit,dailyLimit}) {
    const quota = (pk,sk,limit) => ({ Update: { TableName: table, Key: {pk,sk}, UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one', ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit', ExpressionAttributeNames: {'#count':'count'}, ExpressionAttributeValues: {':zero':0,':one':1,':limit':limit} } });
    try {
      await db.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName:table, Item:{...item,...key(item.owner,item.sk)}, ConditionExpression:'attribute_not_exists(pk)' } },
        quota('LIMIT','TOTAL',totalLimit), quota('LIMIT#'+item.owner,day,dailyLimit)
      ] }));
    } catch(error) { conditionError(error); }
  },
  async change(owner,sk,state,patch) {
    const names={'#state':'state'}, values={':state':state}, sets=[];
    Object.entries(patch).forEach(([k,v],i)=>{names['#k'+i]=k;values[':v'+i]=v;sets.push('#k'+i+' = :v'+i);});
    try { return (await db.send(new UpdateCommand({ TableName:table, Key:key(owner,sk), ConditionExpression:'#state = :state', UpdateExpression:'SET '+sets.join(', '),ExpressionAttributeNames:names,ExpressionAttributeValues:values,ReturnValues:'ALL_NEW' }))).Attributes; }
    catch(error) { conditionError(error); }
  },
  async finish(attempt,record,source) {
    const items=[
      { Update: { TableName:table,Key:key(attempt.owner,attempt.sk),ConditionExpression:'#s = :processing AND contentHash = :hash',UpdateExpression:'SET #s = :approved, resultKey = :result',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':processing':'PROCESSING',':approved':'APPROVED',':hash':attempt.contentHash,':result':record.sk} } },
      { Put: { TableName:table,Item:{...record,...key(record.owner,record.sk)},ConditionExpression:'attribute_not_exists(pk)' } }
    ];
    if(source) items.push({ConditionCheck:{TableName:table,Key:key(source.owner,source.sk),ConditionExpression:'#s = :active AND referenceHash = :hash',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':active':'ACTIVE',':hash':source.referenceHash}}});
    try {await db.send(new TransactWriteCommand({TransactItems:items}));}catch(error){conditionError(error);}
  },
  async remove(owner,sk){await db.send(new DeleteCommand({TableName:table,Key:key(owner,sk)}));}
};
export async function verifiedMfa(token,claims) {
  const item=(await db.send(new GetCommand({TableName:process.env.SECURITY_TABLE,Key:{pk:'MFA#'+digest(token)},ConsistentRead:true}))).Item;
  return Boolean(item && item.kind==='mfa' && item.sub===claims.sub && item.authTime===Number(claims.auth_time) && item.expiresAtEpoch>Date.now()/1000);
}
export const provider = {
  async create({token}) {
    const r=await rekognition.send(new CreateFaceLivenessSessionCommand({ClientRequestToken:token,Settings:{AuditImagesLimit:0,ChallengePreferences:[{Type:'FaceMovementAndLightChallenge'}]}}));
    return {sessionId:r.SessionId,requestId:r.$metadata?.requestId};
  },
  async credentials(id) {
    const r=await sts.send(new AssumeRoleCommand({RoleArn:process.env.STREAM_ROLE_ARN,RoleSessionName:'facial-'+id,DurationSeconds:900}));
    const c=r.Credentials;if(!c)fail(503,'CREDENTIALS_UNAVAILABLE','Não foi possível iniciar a câmera.');
    return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration?.toISOString()};
  },
  async result(sessionId) {
    const r=await rekognition.send(new GetFaceLivenessSessionResultsCommand({SessionId:sessionId}));
    return {status:r.Status,confidence:r.Confidence,image:r.ReferenceImage?.Bytes,challenge:r.Challenge,feedback:(r.Feedback||[]).map(f=>f.Code),requestId:r.$metadata?.requestId};
  },
  async countFaces(image) {
    const r=await rekognition.send(new DetectFacesCommand({Image:{Bytes:image},Attributes:['DEFAULT']}));
    return r.FaceDetails?.length || 0;
  },
  async compare(source,target) {
    const r=await rekognition.send(new CompareFacesCommand({SourceImage:{Bytes:source},TargetImage:{Bytes:target},SimilarityThreshold:0,QualityFilter:'NONE'}));
    return {similarity:r.FaceMatches?.[0]?.Similarity,faceCount:(r.FaceMatches?.length||0)+(r.UnmatchedFaces?.length||0),requestId:r.$metadata?.requestId};
  }
};
export const images = {
  async put(owner,id,bytes) {
    const name='private/'+digest(owner)+'/'+id+'.jpg';
    const r=await s3.send(new PutObjectCommand({Bucket:bucket,Key:name,Body:bytes,ContentType:'image/jpeg',ServerSideEncryption:'AES256',IfNoneMatch:'*'}));
    return {key:name,version:r.VersionId};
  },
  async get(name,version) {
    const r=await s3.send(new GetObjectCommand({Bucket:bucket,Key:name,...(version?{VersionId:version}:{})}));
    return r.Body.transformToByteArray();
  },
  async remove(name,version) {await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:name,...(version?{VersionId:version}:{})}));}
};
