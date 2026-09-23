# JP EntregaEPI V12

Projeto de teste para migração do EntregaEPI para arquitetura com frontend estático e backend Node.js/Express preparado para AWS Lambda.

A versão V11 atual em produção continua separada e não deve ser alterada por este repositório.

## Arquitetura prevista

- Frontend estático
- Backend Node.js/Express
- AWS Lambda
- API Gateway HTTP API
- DynamoDB on-demand
- Arquivos em S3
- Biometria local no Windows com JP Biometria + Java + SDK NITGEN

## Branch de teste

Esta branch é apenas de teste:

```text
v12-teste
```

## Estrutura publicada no GitHub

```text
backend/
packages/
MIGRACAO_AUTOMATIZADA.md
README.md
```

A pasta `backend/` já está expandida e pode ser testada diretamente.

## Teste local do backend

```bash
cd backend
npm install
npm start
```

Em outro terminal:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/caepi/365
```

## Objetivo

Testar a V12 em ambiente separado antes de qualquer migração da produção.

Ambiente previsto de teste:

```text
https://www.jptreinamentos.com.br/EntregaEPI-v12-teste
```

## Observação

A ficha de EPI deve preservar os campos de identificação do trabalhador, função, matrícula eSocial, tipo da movimentação e o Termo de Responsabilidade antes dos EPIs.
