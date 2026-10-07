# JP EntregaEPI 12.7.1

Aplicação de entrega e registro de EPIs com autenticação Cognito, API em Lambda
e persistência em DynamoDB.

- Aplicação: https://www.jptreinamentos.com.br/EntregaEPI/
- Versão e commit publicados: https://www.jptreinamentos.com.br/EntregaEPI/version.json
- Guia de implantação: [docs/DEPLOY_V12_7_1.md](docs/DEPLOY_V12_7_1.md)

## Ficha aprovada

A ficha mantém nome do trabalhador, função, matrícula eSocial e tipo da
movimentação, seguidos do **Termo de Responsabilidade**, antes da relação dos
EPIs. O cabeçalho e os itens são tratados para impressão, inclusive em fichas
com várias páginas. A situação da assinatura é exibida conforme o registro;
uma imagem recebida não é apresentada como biometria verificada.

## Consulta CAEPI

O pacote utiliza uma cópia datada da base pública oficial do Ministério do
Trabalho e Emprego. O endereço, os hashes e a data da fonte estão em
[data/caepi-source.json](data/caepi-source.json). O preparo baixa o ZIP fixado,
confere seu SHA-256, valida o manifesto e cada parte compactada e somente então
instala os dados de consulta no backend.

A interface informa a origem e a data da cópia. A resposta não afirma consulta
ao vivo ou validação independente. Registros ambíguos impedem o preenchimento
automático; o operador precisa conferir os dados na fonte oficial. Dados
complementares locais ficam identificados como tal.

## Acesso

O login utiliza o pool e o cliente Cognito existentes. As rotas de cadastros
exigem JWT; saúde, consulta pública de CA e preflight CORS permanecem públicos.
O backend aplica a autorização por perfil e vínculo da empresa. A implantação
não cria usuários, não concede grupos ou perfis e não migra dados. Contas sem
perfil ou vínculo seguro não recebem acesso aos cadastros.

## Testes locais

Use Node.js 22 e Python 3. Os testes usam dados sintéticos e o catálogo público
de CAs, sem contas ou registros de trabalhadores do ambiente de produção.

```bash
npm ci --prefix backend --no-audit --no-fund
python3 infra/fetch_ca_snapshot.py
npm test --prefix backend
python3 -m unittest discover -s infra -p 'test_*.py' -v
npm ci --prefix tests --no-audit --no-fund
npm --prefix tests run install-browser
npm --prefix tests test
```

O teste de navegador precisa baixar Chromium na primeira execução. Suas imagens,
PDFs e resultados em `tests/output/` contêm somente exemplos sintéticos.

## Publicação

O workflow **Testar e publicar JP EntregaEPI** executa os testes nas branches
`main`, `v12-teste` e `install-v12-7-recovery-20261006`. Somente `main`
publica, usando o mesmo commit aprovado pelo job de testes. A execução manual
também é restrita a `main`, sem parâmetros de referência ou destino.

Antes de publicar, a automação valida a infraestrutura existente, verifica os
backups, configura a proteção JWT e atualiza código e runtime da Lambda para
Node.js 22, preservando variáveis desconhecidas. Depois confere o backend,
publica os arquivos estáticos na ordem prevista, invalida o cache e compara os
bytes públicos com seus hashes.

A presença deste código no repositório não comprova uma instalação concluída.
Use o resultado do workflow, o relatório público e o `version.json` para
confirmar versão e commit. O instalador manual antigo foi desativado.
