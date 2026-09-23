#!/usr/bin/env bash
set -euo pipefail

APP_PREFIX="EntregaEPI-v12-teste"
S3_BUCKET="pagina-conteudo-cloudfront"
CLOUDFRONT_DIST_ID="E2Q4EB4LP1LFXF"
REGION="sa-east-1"
LAMBDA_NAME="jp-entregaepi-v12-api"
ROLE_NAME="jp-entregaepi-v12-lambda-role"
API_NAME="jp-entregaepi-v12-http-api"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "========================================"
echo "JP EntregaEPI V12 - deploy mínimo AWS"
echo "========================================"
echo "Região: $REGION"
echo "Frontend: s3://$S3_BUCKET/$APP_PREFIX"
echo "Lambda: $LAMBDA_NAME"
echo "API: $API_NAME"
echo

echo "[1/9] Conferindo estrutura..."
test -f backend/package.json
test -f backend/src/lambda.js
test -f frontend/EntregaEPI/index.html
mkdir -p .deploy

echo "[2/9] Criando/validando role Lambda..."
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  cat > .deploy/lambda-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
JSON
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file://.deploy/lambda-trust.json >/dev/null
  aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
  echo "Aguardando propagação da role..."
  sleep 12
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"
echo "Role ARN: $ROLE_ARN"

echo "[3/9] Empacotando backend Express/Lambda sem rsync..."
rm -rf .deploy/backend-package .deploy/lambda.zip
mkdir -p .deploy/backend-package
cp -a backend/. .deploy/backend-package/
rm -rf .deploy/backend-package/node_modules
rm -f .deploy/backend-package/package-lock.json
cd .deploy/backend-package
npm install --omit=dev >/dev/null
zip -qr ../lambda.zip .
cd "$ROOT_DIR"

echo "[4/9] Criando ou atualizando Lambda..."
if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$LAMBDA_NAME" --zip-file fileb://.deploy/lambda.zip --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$LAMBDA_NAME" --region "$REGION"
else
  aws lambda create-function \
    --function-name "$LAMBDA_NAME" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler src/lambda.handler \
    --zip-file fileb://.deploy/lambda.zip \
    --timeout 30 \
    --memory-size 256 \
    --region "$REGION" >/dev/null
  aws lambda wait function-active --function-name "$LAMBDA_NAME" --region "$REGION"
fi
LAMBDA_ARN="$(aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" --query 'Configuration.FunctionArn' --output text)"
echo "Lambda ARN: $LAMBDA_ARN"

echo "[5/9] Criando ou localizando API Gateway HTTP API..."
API_ID="$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)"
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID="$(aws apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --cors-configuration 'AllowOrigins=[*],AllowMethods=[GET,POST,PUT,PATCH,DELETE,OPTIONS],AllowHeaders=[content-type,authorization],MaxAge=3600' \
    --region "$REGION" \
    --query 'ApiId' --output text)"
fi
echo "API ID: $API_ID"

INTEGRATION_ID="$(aws apigatewayv2 get-integrations --api-id "$API_ID" --region "$REGION" --query "Items[?IntegrationUri=='$LAMBDA_ARN'].IntegrationId | [0]" --output text)"
if [ -z "$INTEGRATION_ID" ] || [ "$INTEGRATION_ID" = "None" ]; then
  INTEGRATION_ID="$(aws apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$LAMBDA_ARN" \
    --payload-format-version "2.0" \
    --region "$REGION" \
    --query 'IntegrationId' --output text)"
fi
echo "Integration ID: $INTEGRATION_ID"

ROUTES="$(aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" --query 'Items[].RouteKey' --output text || true)"
if ! echo "$ROUTES" | grep -q 'ANY /{proxy+}'; then
  aws apigatewayv2 create-route --api-id "$API_ID" --route-key 'ANY /{proxy+}' --target "integrations/$INTEGRATION_ID" --region "$REGION" >/dev/null
fi
if ! echo "$ROUTES" | grep -q 'ANY /'; then
  aws apigatewayv2 create-route --api-id "$API_ID" --route-key 'ANY /' --target "integrations/$INTEGRATION_ID" --region "$REGION" >/dev/null
fi
if ! aws apigatewayv2 get-stages --api-id "$API_ID" --region "$REGION" --query 'Items[].StageName' --output text | grep -q '^\$default$'; then
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy --region "$REGION" >/dev/null
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
aws lambda add-permission \
  --function-name "$LAMBDA_NAME" \
  --statement-id "apigw-v12-$API_ID" \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/*" \
  --region "$REGION" >/dev/null 2>&1 || true

API_ENDPOINT="https://${API_ID}.execute-api.${REGION}.amazonaws.com"
echo "API endpoint: $API_ENDPOINT"

echo "[6/9] Preparando config do frontend V12..."
cat > frontend/EntregaEPI/config.js <<EOF
window.JP_CONFIG = {
  version: "12.0.0-teste",
  appBasePath: "/$APP_PREFIX/",
  apiBaseUrl: "$API_ENDPOINT",
  cognitoRegion: "sa-east-1",
  userPoolId: "sa-east-1_3FNCoTvr0",
  clientId: "2q2inha617oeer4vb0m0hjoja0",
  ambiente: "teste"
};
EOF

echo "[7/9] Publicando frontend estático em /$APP_PREFIX..."
aws s3 sync frontend/EntregaEPI/ "s3://$S3_BUCKET/$APP_PREFIX/" \
  --delete \
  --exclude 'biometria/*.exe' \
  --cache-control 'no-store, no-cache, must-revalidate'
aws s3api put-object --bucket "$S3_BUCKET" --key "$APP_PREFIX" --body frontend/EntregaEPI/index.html --content-type 'text/html; charset=utf-8' --cache-control 'no-store, no-cache, must-revalidate' >/dev/null
aws s3api put-object --bucket "$S3_BUCKET" --key "$APP_PREFIX/" --body frontend/EntregaEPI/index.html --content-type 'text/html; charset=utf-8' --cache-control 'no-store, no-cache, must-revalidate' >/dev/null
aws s3api put-object --bucket "$S3_BUCKET" --key "$APP_PREFIX/index.html" --body frontend/EntregaEPI/index.html --content-type 'text/html; charset=utf-8' --cache-control 'no-store, no-cache, must-revalidate' >/dev/null

echo "[8/9] Limpando cache CloudFront..."
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DIST_ID" --paths "/$APP_PREFIX" "/$APP_PREFIX/" "/$APP_PREFIX/*" >/dev/null

echo "[9/9] Testes finais..."
echo "API /health:"
curl -fsS "$API_ENDPOINT/health"
echo
echo "API /api/caepi/365:"
curl -fsS "$API_ENDPOINT/api/caepi/365"
echo

echo
echo "========================================"
echo "V12 mínima publicada com sucesso"
echo "========================================"
echo "Frontend teste: https://www.jptreinamentos.com.br/$APP_PREFIX?v=120"
echo "API teste: $API_ENDPOINT"
echo "V11 produção preservada: https://www.jptreinamentos.com.br/EntregaEPI"
echo "Aguarde 1 a 3 minutos e pressione Ctrl+Shift+R no navegador."
