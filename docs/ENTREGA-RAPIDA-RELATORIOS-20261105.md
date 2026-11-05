# EntregaEPI 12.11.0 — publicação de 05/11/2026

Código publicado: `14408cb6b80cb603c9ecba4ba4c6fb2af525ceef`.
Endereço: https://www.jptreinamentos.com.br/EntregaEPI/

## Funcionalidades
- Relações reutilizáveis de EPI por empresa: criar, editar, copiar e inativar; quantidade, tamanho, seleção de itens, última entrega e orientação efetivamente realizada.
- Entrega rápida cria ficha pendente para o fluxo existente de assinatura. Reenvio concorrente da mesma solicitação não duplica a ficha.
- Relatórios por empresa e trabalhador, com filtros de período, equipamento, CA, fabricante, função, setor, situação documental e pendências.
- Exportação PDF e Excel; fichas em ZIP, por filtros, seleção ou histórico completo do trabalhador. Lotes de 25 fichas; resultados informam arquivos incluídos e indisponíveis.
- Originais certificados preservados byte a byte e conferidos por SHA-256. Documentos sem original certificado são identificados como cópias para consulta.
- Ficha revisada: endereço, setor, admissão, tamanho e orientação; termo sem presunção de treinamento, desconto automático ou justa causa automática. Documentos anteriores mantêm conteúdo e modelo históricos.

## Validação
- 272 testes backend e 83 testes frontend aprovados.
- Chromium: fluxo de relação/entrega, idempotência concorrente, PDF/Excel/ZIP, busca global, paginação, isolamento por empresa e layout móvel.
- Regressão dos fluxos de assinatura digital/facial e controles faciais.
- CI: https://github.com/josepazmattos/jp-entregaepi-v12/actions/runs/42040340743
- Revisão visual dos PDFs e capturas desktop/móvel com dados sintéticos.
- Após publicação: health HTTP 200 com versão e SHA corretos; persistência DynamoDB pronta; rotas protegidas recusam requisições sem autenticação (401).
- Três entradas HTML e oito arquivos alterados conferidos por SHA-256 via endereço público. Componentes faciais compilados também respondem HTTP 200. Invalidação CloudFront concluída.
- Acesso público à tela de login verificado em navegador. Não foi criada entrega real nem coletada biometria real de trabalhador para esta validação.

## Publicação e recuperação
- Pacotes de API e assinador foram montados a partir dos arquivos efetivamente publicados, preservando componentes que divergiam da branch main.
- No assinador, somente os módulos compartilhados de integridade e PDF foram atualizados. Cofres, certificados, modelos biométricos, papéis e variáveis existentes foram preservados.
- Backups anteriores de ambos os pacotes, configurações e três entradas HTML foram guardados no armazenamento privado de implantação, junto ao manifesto.
- Relatórios temporários usam armazenamento privado separado, com criptografia, bloqueio público, TLS obrigatório e expiração. A API continua impedida de gravar no acervo original de documentos.
- Downloads exigem mesma empresa e usuário; metadados expiram após uma hora e URLs de download após 60 segundos.
- Em caso de reversão, recuperar pacotes e configurações do backup desta publicação e restaurar as três entradas HTML. Não remover registros ou documentos de usuários criados após a publicação.
