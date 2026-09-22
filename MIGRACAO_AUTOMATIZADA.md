# Migração automatizada do EntregaEPI V12

Este commit adiciona o pacote completo da V12 em formato ZIP para evitar novos conflitos manuais de Git/CloudShell.

Arquivo incluído:

```text
packages/JP_EntregaEPI_V12_EXPRESS_LAMBDA_STATIC.zip
```

## Como usar

1. Baixe o ZIP do repositório.
2. Extraia o conteúdo.
3. A estrutura extraída contém:
   - `frontend/` — frontend estático;
   - `backend/` — backend Node.js/Express preparado para Lambda;
   - `infra/` — scripts de deploy/teste;
   - `docs/` — documentação da migração.

## Segurança

A V11 atual não é alterada por este pacote. A V12 deve ser testada em ambiente paralelo antes de qualquer publicação em produção.

## Modelo de ficha

A ficha deve preservar os dados do trabalhador, função, matrícula eSocial, tipo da movimentação e o Termo de Responsabilidade antes dos EPIs.
