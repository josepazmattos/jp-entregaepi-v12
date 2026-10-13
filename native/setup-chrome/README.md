# Instalador JP Biometria para Chrome

Um executável x86 escolhe componentes amd64 em Windows Intel/AMD de 64 bits e x86 em Windows de 32 bits. Destinos: Windows 10 x86/x64 e Windows 11 x64. Windows ARM não está incluído. O driver NITGEN deve estar instalado manualmente e ser compatível com o Windows da máquina.

Inclui o agente bio2 atual, SDK eNBioBSP 5.2.0.6 e Java privado; não exige Java global, escolha de arquivos ou serial pelo cliente. Não instala drivers, não solicita elevação e não altera a lógica biométrica/certificados. A instalação existente do SDK continua com prioridade no agente. Arquivos divergentes não são sobrescritos. A chave da estação é preservada na reinstalação.

## Limitação impeditiva da homologação

O mesmo SDK original retornou NITGEN_15 nos testes Windows anteriores. O pacote resolve a ausência dos arquivos e mantém explícita uma eventual recusa de inicialização. Não é aprovado como solução para NITGEN_15 nem como funcionamento garantido em todas as versões do Windows. A homologação depende da inicialização do SDK e da captura física na máquina do cliente.

Os testes de instalação usam Windows Server 2022/2025 em CI, incluindo Java/SDK x86 sob WOW64. Eles não substituem testes em Windows 10 de 32 bits, Windows 10/11 de 64 bits, Chrome e leitor USB real. Os relatórios separam instalação dos componentes e aprovação de funcionamento biométrico.

## Compilação

`python native/setup-chrome/build.py --output native/setup-chrome/dist --build-sha <commit completo>`

Os componentes são fixados por SHA-256 em runtime-lock.json. O build verifica a arquitetura dos executáveis e bibliotecas. DLLs de idiomas sem código são verificadas como recursos. Nenhum driver ou serial é incluído.

## Uso após validação na máquina

1. Instalar manualmente o driver correspondente ao leitor.
2. Executar JP-Biometria-Windows-10-11.exe no usuário que utiliza o aplicativo.
3. No Chrome, abrir o EntregaEPI, permitir acesso à rede local se solicitado e usar Verificar leitor / Testar captura.

Se aparecer NITGEN_15, enviar o código ao suporte para obter uma instalação válida do SDK do fabricante. Não repetir reinstalações como se fossem uma correção comprovada.
