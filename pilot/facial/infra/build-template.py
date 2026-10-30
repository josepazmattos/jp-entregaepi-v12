"""Isolated pilot infrastructure. No production API, reader or certificate changes."""
import json
from pathlib import Path

ref=lambda value:{'Ref':value}
sub=lambda value:{'Fn::Sub':value}
arn=lambda name:{'Fn::GetAtt':[name,'Arn']}
statement=lambda actions,resource,**extra:{'Effect':'Allow','Action':actions,'Resource':resource,**extra}
policy=lambda statements:{'Version':'2012-10-17','Statement':statements}
resource=lambda kind,props,**extra:{'Type':kind,'Properties':props,**extra}
retained={'DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain'}
params={
 'ArtifactBucket':{'Type':'String','AllowedPattern':'[a-z0-9.-]+'},
 'ArtifactKey':{'Type':'String','AllowedPattern':r'facial-pilot/[a-zA-Z0-9/_.-]+\.zip'},
 'SecurityTable':{'Type':'String','Default':'jp-entregaepi-security-sessions','AllowedPattern':'[a-zA-Z0-9_.-]+'},
 'UserPoolId':{'Type':'String','Default':'sa-east-1_3FNCoTvr0','AllowedPattern':'sa-east-1_[a-zA-Z0-9]+'},
 'ClientId':{'Type':'String','Default':'2q2inha617oeer4vb0m0hjoja0','AllowedPattern':'[a-z0-9]+'},
 'PilotEnd':{'Type':'String','AllowedPattern':r'2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z'},
 'CaptureEnabled':{'Type':'String','Default':'true','AllowedValues':['true','false']}
}
r={}
r['Data']=resource('AWS::DynamoDB::Table',{'BillingMode':'PAY_PER_REQUEST','AttributeDefinitions':[{'AttributeName':'pk','AttributeType':'S'},{'AttributeName':'sk','AttributeType':'S'}],'KeySchema':[{'AttributeName':'pk','KeyType':'HASH'},{'AttributeName':'sk','KeyType':'RANGE'}],'TimeToLiveSpecification':{'AttributeName':'expiresAtEpoch','Enabled':True},'SSESpecification':{'SSEEnabled':True}},**retained)
r['Images']=resource('AWS::S3::Bucket',{'PublicAccessBlockConfiguration':{'BlockPublicAcls':True,'IgnorePublicAcls':True,'BlockPublicPolicy':True,'RestrictPublicBuckets':True},'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]},'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},'VersioningConfiguration':{'Status':'Enabled'},'LifecycleConfiguration':{'Rules':[{'Id':'pilot-images','Status':'Enabled','Prefix':'private/','ExpirationInDays':7,'NoncurrentVersionExpiration':{'NoncurrentDays':1},'AbortIncompleteMultipartUpload':{'DaysAfterInitiation':1}}]}},**retained)
r['ImagesPolicy']=resource('AWS::S3::BucketPolicy',{'Bucket':ref('Images'),'PolicyDocument':policy([{'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':[arn('Images'),sub('${Images.Arn}/*')],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}])})
r['Logs']=resource('AWS::Logs::LogGroup',{'LogGroupName':sub('/aws/lambda/${AWS::StackName}-api'),'RetentionInDays':7},**retained)
r['AccessLogs']=resource('AWS::Logs::LogGroup',{'RetentionInDays':7},**retained)
r['StreamRole']=resource('AWS::IAM::Role',{'AssumeRolePolicyDocument':policy([{'Effect':'Allow','Principal':{'AWS':sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:root')},'Action':'sts:AssumeRole','Condition':{'ArnEquals':{'aws:PrincipalArn':sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${AWS::StackName}-api-role')}}}]),'Policies':[{'PolicyName':'start-one-liveness-stream','PolicyDocument':policy([statement('rekognition:StartFaceLivenessSession','*',Condition={'StringEquals':{'aws:RequestedRegion':'sa-east-1'}})])}]})
r['ApiRole']=resource('AWS::IAM::Role',{'RoleName':sub('${AWS::StackName}-api-role'),'AssumeRolePolicyDocument':policy([{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]),'Policies':[{'PolicyName':'isolated-pilot-access','PolicyDocument':policy([
 statement(['logs:CreateLogStream','logs:PutLogEvents'],arn('Logs')),
 statement(['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],arn('Data')),
 statement('dynamodb:GetItem',sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${SecurityTable}'),Condition={'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['MFA#*']}}),
 statement(['s3:GetObject','s3:GetObjectVersion','s3:PutObject','s3:DeleteObject','s3:DeleteObjectVersion'],sub('${Images.Arn}/private/*')),
 statement(['rekognition:CreateFaceLivenessSession','rekognition:GetFaceLivenessSessionResults','rekognition:CompareFaces','rekognition:DetectFaces'],'*',Condition={'StringEquals':{'aws:RequestedRegion':'sa-east-1'}}),
 statement('sts:AssumeRole',arn('StreamRole'))
 ])}]})
r['Function']=resource('AWS::Lambda::Function',{'FunctionName':sub('${AWS::StackName}-api'),'Runtime':'nodejs22.x','Architectures':['x86_64'],'Handler':'index.handler','MemorySize':512,'Timeout':28,'ReservedConcurrentExecutions':2,'Role':arn('ApiRole'),'Code':{'S3Bucket':ref('ArtifactBucket'),'S3Key':ref('ArtifactKey')},'Environment':{'Variables':{'PILOT_TABLE':ref('Data'),'PILOT_BUCKET':ref('Images'),'SECURITY_TABLE':ref('SecurityTable'),'USER_POOL_ID':ref('UserPoolId'),'CLIENT_ID':ref('ClientId'),'PILOT_END':ref('PilotEnd'),'CAPTURE_ENABLED':ref('CaptureEnabled'),'STREAM_ROLE_ARN':arn('StreamRole')}}},DependsOn=['Logs'])
r['Api']=resource('AWS::ApiGatewayV2::Api',{'Name':sub('${AWS::StackName}-api'),'ProtocolType':'HTTP','CorsConfiguration':{'AllowOrigins':['https://www.jptreinamentos.com.br','https://jptreinamentos.com.br'],'AllowMethods':['GET','POST','DELETE','OPTIONS'],'AllowHeaders':['authorization','content-type'],'MaxAge':300}})
r['Jwt']=resource('AWS::ApiGatewayV2::Authorizer',{'ApiId':ref('Api'),'Name':'master-cognito','AuthorizerType':'JWT','IdentitySource':['$request.header.Authorization'],'JwtConfiguration':{'Audience':[ref('ClientId')],'Issuer':sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPoolId}')}})
r['Integration']=resource('AWS::ApiGatewayV2::Integration',{'ApiId':ref('Api'),'IntegrationType':'AWS_PROXY','IntegrationUri':arn('Function'),'PayloadFormatVersion':'2.0','TimeoutInMillis':29000})
for name,route in [('Route','ANY /{proxy+}'),('Health','GET /health'),('Preflight','OPTIONS /{proxy+}')]:
 props={'ApiId':ref('Api'),'RouteKey':route,'Target':{'Fn::Join':['/',['integrations',ref('Integration')]]},'AuthorizationType':'JWT' if name=='Route' else 'NONE'}
 if name=='Route':props['AuthorizerId']=ref('Jwt')
 r[name]=resource('AWS::ApiGatewayV2::Route',props)
r['Stage']=resource('AWS::ApiGatewayV2::Stage',{'ApiId':ref('Api'),'StageName':'$default','AutoDeploy':True,'DefaultRouteSettings':{'ThrottlingBurstLimit':5,'ThrottlingRateLimit':3},'AccessLogSettings':{'DestinationArn':arn('AccessLogs'),'Format':'{"requestId":"$context.requestId","route":"$context.routeKey","status":"$context.status"}'}})
r['Invoke']=resource('AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':ref('Function'),'Principal':'apigateway.amazonaws.com','SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*')})
t={'AWSTemplateFormatVersion':'2010-09-09','Description':'EntregaEPI isolated voluntary facial pilot; no production writes or certificates.','Parameters':params,'Resources':r,'Outputs':{'ApiUrl':{'Description':'Authenticated facial pilot HTTP API','Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com')},'FunctionName':{'Description':'Isolated pilot Lambda','Value':ref('Function')},'ImagesBucket':{'Description':'Private temporary facial images','Value':ref('Images')},'TableName':{'Description':'Temporary pilot records only','Value':ref('Data')}}}
Path(__file__).with_name('stack.json').write_text(json.dumps(t,indent=2)+'\n')
