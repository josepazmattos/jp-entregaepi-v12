# Implantação JP EntregaEPI V12.8.0

Este guia conserva o nome de arquivo histórico utilizado desde a V12.7.1.
A V12.8.0 acrescenta empresas clientes com acesso próprio, logos, importação de
trabalhadores por Excel e catálogo comum de equipamentos. A diagramação da
V12.7.2 e o Termo de Responsabilidade aprovado são mantidos. Os fluxos de uso
estão em [V12_8_EMPRESAS_E_IMPORTACAO.md](V12_8_EMPRESAS_E_IMPORTACAO.md).

## Fluxo autorizado

O repositório de aplicação é `josepazmattos/jp-entregaepi-v12`. O workflow
**Testar e publicar JP EntregaEPI** testa alterações nas branches `main`,
`v12-teste` e `install-v12-7-recovery-20261006`.

As branches de revisão executam os testes. A promoção do commit revisado para
`main` inicia uma nova execução: os testes precisam passar antes do job de
publicação. Uma repetição manual usa **Actions → Testar e publicar JP EntregaEPI
→ Run workflow → main**. Não há seleção de prefixo, infraestrutura ou commit
arbitrário.

O job de testes não possui permissão para solicitar token OIDC. Somente o job
de publicação, dependente dos testes, assume a role AWS configurada. Checkout,
Node.js, autenticação AWS e upload de artefatos estão fixados por SHA de commit.

## Infraestrutura existente

| Recurso | Destino |
| --- | --- |
| Conta AWS | `003020057405` |
| Região | `sa-east-1` |
| Role do GitHub Actions | `jp-entregaepi-v12-github-actions-role` |
| Lambda | `jp-entregaepi-v12-api` |
| DynamoDB | `jp-entregaepi-v12`, chaves `pk` e `sk` do tipo string |
| HTTP API | `g4pdu3t1va` |
| Bucket de publicação | `pagina-conteudo-cloudfront` |
| Prefixo público | `EntregaEPI` |
| CloudFront | `E2Q4EB4LP1LFXF` |
| Cognito | Pool `sa-east-1_3FNCoTvr0`, cliente público `2q2inha617oeer4vb0m0hjoja0` |

A automação valida a conta assumida, a região, a tabela ativa, o esquema de
chaves, a função e sua revisão, a integração Lambda da API e o estágio com
implantação automática. Também confere os pré-requisitos de Cognito e TTL
abaixo, antes de qualquer mutação ou envio de backup. Ela recusa destinos e
configurações incompatíveis. A AWS CLI precisa suportar as condições de escrita
usadas para evitar sobrescrever alterações concorrentes.

A implantação utiliza os recursos existentes. Ela não recria tabelas ou roles,
não modifica Cognito ou TTL e não executa migração de cadastros. O provisionamento
de usuários ocorre posteriormente, por solicitação autenticada do Master na API.

## Pré-requisitos administrativos da V12.8.0

A configuração inicial é uma etapa administrativa separada da publicação.
Depois de preparada, o workflow apenas a consulta. `infra/deploy.py` permite
somente `DescribeUserPool`, `DescribeUserPoolClient` e `ListGroups` em Cognito,
além de `DescribeTable` e `DescribeTimeToLive` no DynamoDB.

O preflight exige:

- Pool e cliente exatamente iguais aos destinos desta aplicação, com cliente
  público sem segredo e cadastro público de usuários desativado.
- Atributo `custom:empresa_id` do tipo String, imutável, não obrigatório e sem
  a marca de atributo exclusivo de desenvolvedor.
- `ReadAttributes` explícito incluindo `custom:empresa_id`; `WriteAttributes`
  explícito excluindo esse atributo, sem curingas. A omissão não comprova que
  o cliente perdeu a permissão padrão. A leitura deve ser limitada aos campos
  necessários, para que o Cognito retorne a configuração explícita.
- Presença dos fluxos atuais `ALLOW_USER_PASSWORD_AUTH`,
  `ALLOW_REFRESH_TOKEN_AUTH` e `ALLOW_USER_SRP_AUTH`. Fluxos adicionais não são
  removidos pela validação.
- Grupos `MASTER` e `EMPRESA` pertencentes ao pool esperado.
- TTL da tabela em `ENABLED` ou `ENABLING`, no atributo `expiresAtEpoch`.
  Esse atributo identifica os controles temporários de importação e recibos;
  os cadastros e fichas de negócio não recebem expiração automática.

O atributo imutável é definido na criação administrativa da conta. O cliente
precisa conseguir lê-lo no token e não pode defini-lo ou alterá-lo. Não basta
confiar apenas no nome de um login ou em `x-empresa-id`. A aplicação valida
emissão, público, tipo e validade do token, o grupo e o vínculo autorizado.

A role de implantação precisa das quatro novas consultas de metadados acima,
limitadas ao pool e à tabela existentes. A role da Lambda precisa de
`AdminGetUser`, `AdminCreateUser` e `AdminAddUserToGroup` no pool, além das
operações de persistência e transações da tabela. A automação de implantação
não concede essas permissões nem cria usuários. Alterações administrativas
devem preservar as demais configurações do cliente, política de senha e
validade de tokens.

A senha inicial digitada no aplicativo é composta pelos oito primeiros
caracteres do CNPJ. O fluxo inicial transforma essa entrada conforme a convenção
pública definida em `company-accounts.js`, atendendo à política atual do pool.
A convenção não é um segredo e não é persistida no cadastro. Cognito exige
`NEW_PASSWORD_REQUIRED`; o navegador pede a senha definitiva. O backend usa
`SUPPRESS`, sem enviar convites, e não redefine contas durante uma retomada.

## Etapas e critérios de sucesso

1. Instalar dependências pelo lockfile com Node.js 22 e preparar a base CAEPI
   fixada em `data/caepi-source.json`.
2. Executar os testes do backend, da ficha, do navegador e da automação.
3. No job de publicação, conferir se o commit do checkout é exatamente o commit
   aprovado pelos testes e preparar novamente as dependências de produção e a
   mesma base CAEPI.
4. Validar infraestrutura, vínculo Cognito e TTL; gerar o pacote Lambda e os
   arquivos estáticos, incluindo `assets/modelo-trabalhadores.xlsx`.
5. Baixar o código e a configuração anteriores da Lambda para armazenamento
   temporário privado do runner e verificar o hash do ZIP.
6. Copiar e verificar os arquivos públicos que serão sobrescritos, incluindo as
   chaves de entrada da aplicação.
7. Configurar o authorizer JWT e as rotas públicas previstas.
8. Atualizar o código Lambda com condição de revisão e depois atualizar runtime
   e ambiente. Aguardar a conclusão das duas operações.
9. Conferir saúde, versão, commit, acesso à persistência, consulta pública de CA
   com a origem esperada e rejeição de chamada anônima a cadastro.
10. Publicar assets, configuração e manifesto de versão antes das entradas HTML.
    Cada gravação usa condição sobre o objeto anterior e metadados de versão,
    commit e SHA-256.
11. Invalidar apenas os caminhos da aplicação no CloudFront, aguardar a
    conclusão, comparar os bytes públicos com os hashes preparados e repetir as
    verificações do backend.

A aplicação fica disponível em
https://www.jptreinamentos.com.br/EntregaEPI/.
A publicação só é considerada concluída quando as etapas terminam com sucesso.

## Variáveis e compatibilidade

A Lambda passa a usar Node.js 22. O script mescla as variáveis existentes e
define `APP_VERSION`, `BUILD_SHA`, `TABLE_NAME`, `DATA_MODE`,
`COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID` e
`AUTH_COMPANY_CLAIM=custom:empresa_id`. Variáveis desconhecidas são preservadas.
A configuração da claim somente é aplicada depois de passar pelo preflight
de imutabilidade e permissões de leitura/escrita do cliente.

O código é compatível com os runtimes validados pelo preparo. O estado anterior
de runtime, ambiente e código é guardado para restauração no runner. A automação
usa condições de revisão da Lambda para detectar uma mudança concorrente.

## Autenticação e dados existentes

O authorizer usa o issuer do pool Cognito e o cliente já configurado. As rotas
privadas da integração da aplicação exigem JWT. Permanecem públicas:

- `GET /health`;
- `GET /api/caepi` e `GET /api/caepi/{ca}`;
- requisições `OPTIONS` necessárias ao CORS.

A configuração CORS preserva as opções existentes e inclui `x-empresa-id`.
O backend verifica perfil e escopo da empresa. Informar esse cabeçalho não
concede acesso por si só. Somente Master cria empresas ou provisiona acessos.
Trabalhadores e fichas mantêm escopo por empresa; o catálogo descritivo de
equipamentos é compartilhado entre contas autorizadas, sem expor empresa de
origem, autoria ou observações privadas.

As verificações automáticas não fazem login com contas reais. Elas verificam
que uma requisição sem token a `/api/empresas` recebe HTTP 401. O teste de
saúde realiza somente uma leitura técnica de prontidão no DynamoDB, sem
enumerar cadastros.

## Backup e recuperação

Os backups de frontend incluem somente os arquivos públicos que a execução
pretende sobrescrever. Eles usam o prefixo
`EntregaEPI-backup-actions-<execução>-<tentativa>` e são conferidos por hash antes
de alterar a aplicação. Esses arquivos continuam sendo conteúdo público, como
as versões que substituem. O script não faz sincronização com `--delete`.

O ZIP e a configuração anteriores da Lambda ficam exclusivamente em
`.deploy/private/`, com acesso restrito no runner. Não são enviados ao bucket,
ao CloudFront, aos logs ou a artefatos do repositório público. A URL temporária
usada para baixar o código também não é registrada.

Se uma etapa falhar após alterar código ou frontend, o script tenta restaurar
os arquivos anteriores e o código, runtime e ambiente da Lambda. Antes de
restaurar, verifica que os objetos ou o código atuais pertencem à própria
execução. Uma alteração concorrente desconhecida interrompe a restauração
daquele recurso em vez de sobrescrevê-la.

A recuperação restaura código e arquivos; não desfaz alterações de cadastros
feitas por usuários e não remove a configuração administrativa do Cognito/TTL.
A proteção JWT não é removida na recuperação: reabrir o acesso anônimo aos
cadastros não faz parte da restauração. Se a recuperação encontrar erro, o
relatório registra a falha para intervenção. A recuperação automática depende
do runner continuar ativo; perda abrupta da máquina ou encerramento forçado
pode impedir sua execução e elimina os backups temporários da Lambda.

## Evidências públicas e inspeção

O job de testes pode guardar `tests/output/`: capturas de tela, PDFs e
resultados com pessoas, empresas e movimentações fictícias. O job de publicação
guarda exclusivamente `.deploy/public-report.json`, com versão, commit,
etapas, hashes e resultado das verificações.

O endereço
https://www.jptreinamentos.com.br/EntregaEPI/version.json
identifica o commit e os hashes preparados para publicação, além da procedência
da cópia CAEPI. Compare esse commit com a execução bem-sucedida do workflow.

Um commit criado, um ZIP preparado ou um job iniciado não comprovam uma
instalação. Em caso de falha, use o relatório da execução e os resultados de
restauração antes de afirmar que a nova versão está publicada.

## Ficha e consulta CAEPI

A ficha preserva o cabeçalho aprovado: nome, função, matrícula eSocial e tipo
da movimentação. O Termo de Responsabilidade aparece antes da relação de EPIs.
As situações de assinatura distinguem registro pendente de assinatura
registrada; uma imagem aceita não é apresentada como verificação biométrica.

O catálogo CAEPI é uma cópia datada da base oficial, com origem e hashes
registrados. Sua preparação valida o ZIP, o manifesto e cada arquivo
compactado antes de utilizá-los. A consulta informa que não é ao vivo.
Registros ambíguos impedem preenchimento automático e exigem conferência na
fonte. A data de download não é apresentada como data de atualização oficial.

## Referências técnicas

- [GitHub: claims imutáveis de OIDC](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims)
- [GitHub: autenticação OIDC na AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [AWS: authorizer JWT para HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [AWS CLI: gravação de objetos com condições e checksum](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html)
- [AWS Lambda: runtimes e datas de suporte](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)

- [AWS Cognito: atributos imutáveis e permissões do cliente](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html)
- [AWS Cognito: criação administrativa de contas](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html)
- [AWS DynamoDB: consulta do estado de TTL](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DescribeTimeToLive.html)
- [Receita Federal/Serpro: cálculo do CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf)
