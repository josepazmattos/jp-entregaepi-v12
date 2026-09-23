# Migração automatizada JP EntregaEPI V12

Esta branch contém a estrutura inicial da migração V12.

## Situação atual

O pacote ZIP completo da V12 permanece em:

```text
packages/JP_EntregaEPI_V12_EXPRESS_LAMBDA_STATIC.zip
```

O backend Express/Lambda também foi expandido em:

```text
backend/
```

## Teste do backend no CloudShell

```bash
cd ~/jp-entregaepi-v12

git fetch origin

git checkout v12-teste

git pull origin v12-teste

cd backend
npm install
npm start
```

Em outra aba/terminal:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/caepi/365
```

## Próximo passo

Depois do backend local responder, publicar a V12 em ambiente separado:

```text
/EntregaEPI-v12-teste
```

A V11 de produção permanece intacta.
