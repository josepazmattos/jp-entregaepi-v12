# JP EntregaEPI V12

Projeto separado para testar a migração do EntregaEPI para:

- frontend estático;
- backend Node.js/Express;
- execução em AWS Lambda;
- API Gateway HTTP API;
- banco DynamoDB on-demand;
- arquivos estáticos e modelos em S3/CloudFront;
- biometria local no Windows via JP Biometria + Java + SDK NITGEN.

## Situação

Este repositório foi criado para a V12 paralela. A V11 atual continua publicada separadamente em produção e não deve ser sobrescrita durante os testes.

## Pacote-base gerado

O pacote gerado nesta conversa foi:

`JP_EntregaEPI_V12_EXPRESS_LAMBDA_STATIC.zip`

Ele contém:

```text
frontend/EntregaEPI/
backend/src/
infra/
docs/
.github/workflows/
```

## Estrutura pretendida

```text
frontend/
  EntregaEPI/
    index.html
    config.js
    assets/
    templates/
    biometria/

backend/
  package.json
  src/
    app.js
    lambda.js
    server.js
    routes/
    services/
    db/

infra/
  create-dynamodb-table.sh
  deploy-backend-lambda.sh
  deploy-frontend-s3.sh
  test-api-local.sh
```

## Regra de segurança

A V12 deve ser publicada primeiro em ambiente de teste, por exemplo:

`https://www.jptreinamentos.com.br/EntregaEPI-v12-teste`

Somente depois dos testes item por item ela deve substituir a V11.

## Observação sobre a ficha de EPI

A ficha precisa preservar os campos validados na V11: função, matrícula eSocial, tipo da movimentação e o Termo de Responsabilidade antes dos EPIs.
