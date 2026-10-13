# Resultado — 13/10/2026

Executável: JP-Biometria-Windows-10-11.exe
Tamanho: 103.493.632 bytes
SHA-256: 552bcf517642df94dcb64af25f9ac3169e1b4ad8e6b63d0ccd1d6b4071b11d4b
Commit do executável: 0866887499d6af116a257e6c1364266efc3d906a
CI: https://github.com/josepazmattos/jp-entregaepi-v12/actions/runs/38452270349

Compilação, 92 verificações Java com leitor sintético e testes Go aprovados. O arquivo local e o gerado no CI têm o mesmo SHA-256.

Instalação e reinstalação executadas em Windows Server 2022 e 2025, com SDK/Java x86 e amd64. Nas quatro combinações, os arquivos do SDK carregaram, a identidade da estação foi preservada e a inicialização retornou NITGEN_15. O instalador mostrou falha; nenhuma captura ou assinatura foi reportada como concluída.

NÃO HOMOLOGADO PARA DISTRIBUIÇÃO GERAL. Captura física e Chrome no Windows 10/11 de clientes não foram testados. ARM não suportado pelo pacote. É necessário validar uma instalação funcional do SDK do fabricante antes de liberar como solução definitiva.

A alteração dos botões de produção permanece pendente dessa validação. infra/patch_chrome_downloads.py prepara apenas os textos e links, preservando os demais elementos do aplicativo. Nenhuma mudança de backend, certificados ou dados foi publicada.
