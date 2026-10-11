# Recuperação permanente e consultas — 11/10/2026

## Retenção

Os PDFs definitivos, evidências e materiais de validação continuam em S3 privado, com versionamento e cópia independente. Não há expiração por idade para esses arquivos nem para suas versões antigas. Somente `staging/` contém arquivos temporários de preparação, descartados após sete dias. A validade de 60 segundos de um link de download não é a validade do arquivo.

Os dois bancos têm proteção contra exclusão e recuperação contínua dos últimos 35 dias (limite do serviço DynamoDB). O plano `JPGED-Mensal-Sem-Expiracao` cria snapshots no primeiro dia de cada mês, às 08:00 UTC, mantendo-os sem prazo de expiração no cofre `JPGED-Historico-Permanente`. Há também uma cópia inicial de cada banco anterior à alteração. Fora da janela contínua, recupera-se um snapshot mensal existente, não qualquer segundo do passado.

O armazenamento original e o backup estão na mesma conta/região. O plano não representa recuperação geográfica nem imutabilidade contra um administrador da conta AWS. A API do aplicativo não recebe permissão de administrar os snapshots. Não excluir bancos, chaves de criptografia ou buckets no processo de atualização.

## Consultas

- Listagens de empresas, trabalhadores, fichas, catálogo técnico e auditoria usam índices por empresa/entidade, sem Scan do banco inteiro.
- Os índices contêm somente chaves. Paginação interna de 100 chaves, seguida de BatchGet consistente em lotes de até 100, preserva os registros atuais e o contrato `items` das telas.
- A empresa autenticada continua sendo conferida antes da consulta; o resultado é novamente filtrado após leitura. Uma chave de outra empresa enviada em `recentIds` não libera acesso ao cadastro.
- Cadastros recém-criados são incluídos por chave por até dois minutos, enquanto o índice se propaga. Esse lembrete guarda só IDs na memória da aba e é isolado por sessão/empresa.
- Chaves não processadas são repetidas com espera progressiva limitada. Falha persistente produz erro explícito, nunca uma lista parcial apresentada como completa.
- Escritas, importações e verificações de unicidade mantêm suas leituras consistentes com revisão e transações originais. Não foram trocadas por leituras eventualmente consistentes.
- O catálogo RelatorioCA continua paginado. A lista completa de uma empresa ainda é compatível com a interface existente; esta alteração não estabelece resposta HTTP paginada nas telas antigas.

## Publicação e reversão

Usar `infra/recovery-queries.json` para conferir a configuração. Criar índices um por vez, aguardar ambos ACTIVE, validar Query/BatchGet e somente então adicionar `LIST_ENTITY_INDEX` / `LIST_COMPANY_INDEX` à Lambda. Preservar todas as demais variáveis. O código sem essas duas variáveis mantém o modo anterior, permitindo reversão sem migrar ou apagar cadastros.

Biometria, agente/instalador, cofre, certificados, PKI e geração de PDF não foram alterados. A CI compara esses arquivos com o release `997d35b50066bbd2080ba9bfa5b8e255196ae425` e executa regressões de login, assinatura e JPGED com fixtures sintéticas.

## Recuperação operacional

Restaurar sempre para uma tabela nova, verificar contagens, chaves e hashes, conferir acesso aos PDFs e só então planejar eventual troca da tabela em produção. Nunca restaurar por cima de dados atuais. Recuperar um PDF pela versão original ou pelo bucket de backup; uma nova impressão não substitui o arquivo digital assinado. Manter os originais e as chaves do cofre existentes.

Os snapshots permanentes acumulam custo conforme o volume histórico cresce. Monitorar armazenamento de backups separadamente do custo por documento; não aplicar expiração automática para reduzir custos.
