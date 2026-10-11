import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { httpError } from '../middleware/auth.js';
import { sha256 } from '../services/document-integrity.js';
import { attachmentDisposition } from '../services/document-filename.js';

const region = process.env.AWS_REGION || 'sa-east-1';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({ region, maxAttempts: 3 });
export function createGedStorage({ table = process.env.JPGED_TABLE, bucket = process.env.JPGED_BUCKET, db = client, objects = s3, memory = false } = {}) {
  const records = new Map(), blobs = new Map();
  const ready = () => { if (!memory && (!table || !bucket)) throw httpError(503, 'O JPGED ainda não está configurado.', 'JPGED_UNAVAILABLE'); };
  const key = (company, type, id) => {
    if (![company, type, id].every(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x))) throw httpError(400, 'Identificação JPGED inválida.', 'JPGED_KEY');
    return { pk: `EMPRESA#${company}`, sk: `${type}#${id}` };
  };
  async function get(company, type, id) {
    ready(); const Key = key(company,type,id);
    return memory ? structuredClone(records.get(JSON.stringify(Key)) || null) : (await db.send(new GetCommand({ TableName: table, Key, ConsistentRead: true }))).Item || null;
  }
  async function put(company, type, id, data, expected = 0) {
    ready(); const Key = key(company,type,id), item = { ...data, ...Key, empresaId: company, id, version: expected+1 };
    if (Buffer.byteLength(JSON.stringify(item)) > 280000) throw httpError(413, 'Registro JPGED muito grande.', 'JPGED_RECORD_LIMIT');
    if (memory) { const old=records.get(JSON.stringify(Key)); if ((old?.version||0)!==expected) throw httpError(409,'A operação já foi concluída ou alterada. Atualize.','JPGED_CONFLICT'); records.set(JSON.stringify(Key),structuredClone(item)); }
    else try { await db.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: expected ? '#version = :v' : 'attribute_not_exists(pk)', ...(expected ? { ExpressionAttributeNames: { '#version':'version' }, ExpressionAttributeValues: { ':v':expected } } : {}) })); }
    catch (e) { if(e.name==='ConditionalCheckFailedException') throw httpError(409,'A operação já foi concluída ou alterada. Atualize.','JPGED_CONFLICT'); throw e; }
    return item;
  }
  async function list(company, type, cursor = '') {
    ready(); const Key=key(company,type,'list'); let after;
    if(cursor) { try { after=JSON.parse(Buffer.from(cursor,'base64url')); } catch { throw httpError(400,'Página inválida.','JPGED_CURSOR'); } if(after.pk!==Key.pk || !String(after.sk).startsWith(type+'#') || Object.keys(after).length!==2) throw httpError(400,'Página inválida.','JPGED_CURSOR'); }
    if(memory) return { items:[...records.values()].filter(x=>x.pk===Key.pk&&x.sk.startsWith(type+'#')).map(x=>structuredClone(x)).slice(0,50), cursor:'' };
    const result=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',ExpressionAttributeValues:{':pk':Key.pk,':prefix':type+'#'},Limit:50,ExclusiveStartKey:after,ScanIndexForward:false,ConsistentRead:true}));
    return {items:result.Items||[],cursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):''};
  }
  async function saveBlob(path, data, type = 'application/pdf') {
    ready(); const hash=sha256(data);
    if(memory) {const old=blobs.get(path);if(old&&sha256(old)!==hash)throw httpError(409,'Arquivo já existe.','JPGED_IMMUTABLE');blobs.set(path,Buffer.from(data));return {hash,versionId:'memory'};}
    try { const result=await objects.send(new PutObjectCommand({Bucket:bucket,Key:path,Body:data,ContentType:type,CacheControl:'private, no-store',ServerSideEncryption:'AES256',IfNoneMatch:'*',ChecksumSHA256:Buffer.from(hash,'hex').toString('base64'),Metadata:{sha256:hash}}));return {hash,versionId:result.VersionId}; }
    catch(e){if(e.name==='PreconditionFailed'||e.$metadata?.httpStatusCode===412){const existing=await objects.send(new HeadObjectCommand({Bucket:bucket,Key:path}));if(existing.Metadata?.sha256!==hash||existing.ContentLength!==data.length)throw httpError(409,'O original não pode ser substituído.','JPGED_IMMUTABLE');return {hash,versionId:existing.VersionId};}throw e;}
  }
  async function readBlob(path) {ready();if(memory){if(!blobs.has(path))throw httpError(404,'Arquivo não encontrado.');return Buffer.from(blobs.get(path));}const result=await objects.send(new GetObjectCommand({Bucket:bucket,Key:path}));return Buffer.from(await result.Body.transformToByteArray());}
  async function download(path, filename) {ready();if(memory)return 'https://example.invalid/jpged-test.pdf';return getSignedUrl(objects,new GetObjectCommand({Bucket:bucket,Key:path,ResponseContentDisposition:attachmentDisposition(filename),ResponseCacheControl:'private, no-store'}),{expiresIn:60});}
  return {get,put,list,saveBlob,readBlob,download,configured:()=>memory||Boolean(table&&bucket)};
}
export const gedStorage=createGedStorage();
