# Instalador único JP Biometria

Arquivo: `JP-Biometria-Instalador-Unico.exe` (58.881.714 bytes).

Contém Java privado 8, runtime NITGEN registrado pela ferramenta oficial do fabricante, driver HFDU06 e agente JP Biometria. Não exige instalação separada do SDK ou Java. O driver só é instalado quando necessário; o pedido de elevação limita-se a essa etapa. Não desativa a integridade de memória.

O registro oficial do SDK foi validado em x86 e amd64 com NBioAPI_Init = 0, execução 38462711789. O instalador distribuído atende Intel/AMD de 64 bits.

## Verificação do arquivo distribuído

- Código: `7ec1d3a3388257f818b88e322d2e7487cbfbb255`.
- SHA-256: `d8773cc34e0bcb4cbdb4a3120f7654cdcff7707a4f005343106d0625c48d4d3b`.
- GitHub Actions: execução 38464050840, Windows Server 2022 e 2025.
- Instalação limpa, reinstalação e reparo com SDK legado: SDK inicializado, uma instância do agente, identidade preservada.
- Arquivo corrompido: recusado antes de criar a identidade da estação.
- 81 testes de frontend aprovados; testes Go do pacote e Java/Go do agente aprovados.

Não houve leitor USB nos ambientes de CI. A captura física, a instalação real do driver e as edições cliente Windows 10/11 não foram verificadas nesses testes. O resultado esperado sem hardware é READER_NOT_FOUND com sdk=true; NITGEN_15 e SDK_NOT_FOUND nunca contam como aprovação.

## Publicação

Link único: `/EntregaEPI/updates/12.10.0-unico1/JP-Biometria-Instalador-Unico.exe`.

Os links em Configurações → Downloads e Biometria usam esse mesmo arquivo. A atualização do HTML publicado altera exclusivamente o cartão de Downloads e o link de reparo. O HTML anterior é preservado e a gravação usa o ETag esperado, para não sobrescrever alterações concorrentes.

O SDK/serial original e chaves de transferência não fazem parte do repositório. Os componentes redistribuídos foram preparados pela ferramenta oficial, sem modificar sua validação.
