# Entrega EPI: arquivos versionados

`frontend_release.py` gera `releases/<commit>/assets/` com os mesmos bytes dos arquivos públicos, incluindo os módulos de PDF e workers. O HTML usa esse endereço e mantém `config.js` e os downloads do instalador nos caminhos existentes. `deploy.py` usa o mesmo gerador em futuras publicações.

1. Executar os testes do commit e gerar o pacote com `python3 infra/frontend_release.py --output .deploy/frontend --commit <SHA>`.
2. Publicar os assets com `Cache-Control: public, max-age=31536000, immutable`, sem sobrescrever versões existentes.
3. A distribuição CloudFront `E2Q4EB4LP1LFXF` usa uma regra exclusiva `/EntregaEPI/releases/*`, origem S3 existente, compressão ativada e política `Managed-CachingOptimized` (gzip/Brotli). A regra padrão e os demais aplicativos permanecem independentes.
4. Publicar os três pontos de entrada (`EntregaEPI`, `EntregaEPI/`, `EntregaEPI/index.html`) somente depois de conferir os assets. Usar `no-store, no-cache, must-revalidate`, incluindo em `config.js`.
5. Invalidar os pontos de entrada e conferir a versão, os hashes descomprimidos e os cabeçalhos de cache/compressão no endereço público.

O F5 busca o HTML atual, que aponta para a nova versão. Abas abertas continuam tendo acesso à versão anterior, inclusive aos módulos carregados sob demanda. A proteção existente contra atualização automática durante preenchimento e assinatura permanece ativa. O cache público não inclui APIs, documentos de clientes ou material de certificados.

Para reverter, restaurar os três HTML anteriores e invalidar esses caminhos. Manter as pastas de releases anteriores; não excluir arquivos de uma versão que possa estar em uso. Ajustes de CloudFront devem usar o ETag da configuração recém-consultada e preservar os outros comportamentos.
