# JP Biometria — extensão piloto 0.1.0

Modelo executável para avaliar a comunicação Chrome/Edge → Native Messaging → agente JP já instalado. Toda a implementação está isolada nesta pasta. Nenhum arquivo de produção, driver, algoritmo biométrico, cadastro, certificado ou cofre foi alterado.

## O que o pacote faz

- Extensão Manifest V3 com identidade JP, diagnóstico com próximo passo e captura de teste mediante clique.
- Conector Windows x64 em Go, sem dependências externas, com instalação por usuário ao abrir o EXE. Registra somente suas chaves NativeMessagingHosts no HKCU de Chrome e Edge, nas duas visões do registro.
- Localiza o agente JP nas portas 8789–8799 em paralelo; exige resposta autenticada por HMAC usando a configuração local já existente.
- Consulta `/status`; captura somente via POST `/api/capture` com finalidade fixa `test`. Não chama cadastro, comparação, assinatura, autorização de dispositivo, certificado, desligamento ou reparação.
- Retém a imagem apenas em memória no painel. Limpa ao fechar, sair da visualização, clicar em Limpar ou após 60 segundos. Não envia a imagem ao site, não usa storage e não grava arquivo de captura.
- Inclui `docs/modelo.html`, demonstração visual interativa sem acesso ao hardware.

## Limites importantes do piloto

Este pacote **não é o instalador completo para uma máquina nova**. Precisa de Windows x64, Chrome ou Edge compatível com Manifest V3, Hamster DX, driver instalado manualmente e agente JP com a integração NITGEN já funcionando neste mesmo usuário do Windows. O conector não inclui Java, SDK, driver nem o agente anterior e não corrige sozinho `SDK_NOT_FOUND`.

O site de produção continua com o fluxo existente. O piloto oferece diagnóstico e teste de imagem. Não substitui cadastro/assinatura, não altera a comparação biométrica e não interfere no certificado centralizado.

Não foi executado em um Windows físico com leitor. Não há validação de instalação no registro, driver, arquitetura x86/ARM, antivírus corporativo ou velocidade real de captura. O EXE não tem assinatura Authenticode e a extensão ainda não está publicada nas lojas. A carga sem compactação é restrita ao piloto assistido pela equipe JP.

## Experiência proposta para a versão de clientes

1. A equipe instala o driver manualmente, conforme a máquina.
2. O cliente instala a extensão pela loja e executa uma única vez um conector JP assinado.
3. O aplicativo verifica a conexão e apresenta somente o próximo passo necessário.
4. O conector usa a integração NITGEN existente. O cadastro e a comparação seguem os contratos atuais do aplicativo, com uma validação própria antes de substituir o transporte.

A extensão pode receber atualizações pela loja. O conector nativo exige estratégia de atualização separada, com assinatura e validação de integridade; este piloto não implementa atualização automática nem download/execução de código remoto. O ID da loja deve ser definido antes de gerar a versão distribuída. Não há promessa de funcionamento de uma extensão sozinha sem componente local.

## Instalação e remoção

Abra `extension/guide.html` ou `LEIA-PRIMEIRO.html` no ZIP. Extraia o pacote; carregue a pasta `extension` no modo do desenvolvedor; execute `JP-Biometria-Conector-Piloto.exe`; abra o agente JP existente e use **Verificar leitor**.

O conector instala em `%LOCALAPPDATA%\JP\BiometriaExtensao`. Não requer administrador. É instalado por usuário do Windows; outros perfis precisam de sua própria instalação. Para remover seus registros, execute `JP-Biometria-Conector-Piloto.exe --uninstall`. Remova a extensão pelo navegador e, depois de fechar o conector, apague somente a pasta BiometriaExtensao se desejar.

## Controles do piloto

- Host `br.com.jptreinamentos.biometria`, com um único ID de extensão permitido.
- Entrada JSON com limites de tamanho, campos e comandos fechados. Nenhuma URL ou comando arbitrário pode ser enviado.
- HTTP local somente em `127.0.0.1`, portas fixas; sem proxy, redirecionamentos ou autenticação do site.
- Prova HMAC no ping e identidade consistente no status; nunca envia a chave de controle ao navegador.
- Dados de resposta filtrados. Nenhum template, chave biométrica ou dado do certificado é devolvido.
- Leitura sem repetição automática; exclusão mútua no worker e o bloqueio existente do agente continua valendo.
- API externa aceita somente `status`, somente no frame principal da rota `/EntregaEPI` dos dois domínios JP permitidos, com intervalo mínimo de 3 segundos. Não é utilizada pelo site atual.
- O teste de imagem não comprova identidade. São necessários o cadastro e o fluxo de comparação normais para assinar fichas.

Uma aplicação executada sob o mesmo usuário do Windows não constitui um cofre contra comprometimento desse usuário. Os testes aqui cobrem o contrato deste conector, não certificam segurança absoluta do computador.

## Desenvolvimento

Pré-requisitos: Go 1.23+, Node 22+ e Python 3. Os testes de navegador usam o Playwright instalado em `../../tests/node_modules` e Chromium com suporte a extensões.

```sh
cd connector
go test -race ./...
go vet ./...
cd ..
npm ci --ignore-scripts
npm test
node tests/browser.cjs
python build.py --go /caminho/para/go
```

`build.py` compila o conector para Windows x64, gera o modelo visual e empacota o ZIP. Não publica no site nem nas lojas. Os recursos gráficos vêm do favicon JP já existente no aplicativo. Não há código, binário ou SDK copiado da extensão SOC.

Os resultados executados e as verificações ainda pendentes estão em `docs/TESTES.md`. A suíte de navegador está preparada, mas a execução de Chromium foi bloqueada pela política do ambiente de desenvolvimento. Os testes de DOM usam LinkeDOM em Node e não substituem a validação visual no navegador.

## Critérios para avançar

- Instalar/remover em Windows real, Chrome e Edge, com e sem política corporativa.
- Testar leitor desconectado, conectado, ocupado no NFD e retorno após reconexão.
- Testar agente desligado, SDK ausente e configuração de outro usuário.
- Conferir captura com imagem, cancelamento/timeout e duas abas simultâneas.
- Medir tempos reais (abertura, verificação e captura), comparando com o fluxo atual.
- Só depois integrar o transporte das operações de cadastro e verificação usando o contrato atual, sem alterar identidade, comparação, evidências ou certificação.

Referências técnicas: [Native Messaging Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Distribuição de extensões](https://developer.chrome.com/docs/extensions/how-to/distribute). A arquitetura do SOC fornecida pelo usuário foi referência de funcionamento; seu módulo não foi reutilizado.
