# JP Biometria 12.8.1 — componente local

Este componente conecta o aplicativo JP EntregaEPI ao SDK Java NITGEN no Windows. O instalador inclui somente o inicializador e o agente desenvolvidos para a JP. Não contém Java, driver, DLL, JAR do fabricante, template ou impressão digital real.

## Requisitos da estação

- **Windows de 64 bits** para executar este instalador. A comunicação com o SDK pode usar Java de 32 ou de 64 bits, conforme as DLLs realmente instaladas.
- Leitor NITGEN conectado e reconhecido pelo driver. O utilitário de diagnóstico do fabricante deve estar fechado durante a captura no aplicativo.
- **SDK eNBioBSP com a interface Java**, incluindo `Lib/NBioBSPJNI.jar` e um par de bibliotecas `NBioBSP.dll` + `NBioBSPJNI.dll` da mesma arquitetura. O driver USB, sozinho, não fornece necessariamente esses componentes.
- **Java 8 ou posterior**, da mesma arquitetura das DLLs NITGEN utilizadas. O bytecode JP é compilado para Java 8; a compatibilidade física de cada versão de Java com a instalação específica do SDK ainda exige teste na estação.

O reparador descobre o SDK em pastas NITGEN conhecidas de `Program Files`, `Program Files (x86)` e da unidade do Windows. Uma instalação em outro local pode informar a variável `JP_BIOMETRIA_SDK`, apontando para a pasta que contém `Lib` e `Bin`. Procura Java em `JAVA_HOME`, `JRE_HOME`, PATH, registros JavaSoft do usuário/sistema e pastas usuais dos fornecedores. Confere a arquitetura PE das duas DLLs e a arquitetura efetivamente informada pelo Java; não escolhe um Java incompatível como alternativa.

Não há download automático nem reinstalação do driver ou do SDK. Quando falta Java, o inicializador oferece um serviço de diagnóstico sem captura. Quando Java existe mas falta o SDK, o agente Java oferece o diagnóstico correspondente. Assim, a interface pode distinguir uma dependência ausente de uma conexão local inexistente.

## Instalação, início e reparo

O destino é `%LOCALAPPDATA%\JP\Biometria`. Os arquivos da JP e a configuração ficam sob o usuário atual do Windows. O instalador protege a pasta para esse usuário e para `SYSTEM`, registra o protocolo `jpbiometria://start` em `HKCU\Software\Classes` e registra a inicialização do usuário em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Não cria serviço do sistema nem precisa alterar drivers.

Modos do executável:

| Comando | Resultado |
| --- | --- |
| Sem argumentos | Instala ou repara a ponte, verifica a inicialização e apresenta o resultado em uma janela. |
| `--install-quiet` | Executa o mesmo reparo e emite JSON seguro em stdout; usado pelo teste de instalação Windows. Sucesso: `ok`, `version`, `buildSha`, `port`. Falha: `ok:false`, `version`, `buildSha`, `message`, com código de saída 1. |
| `--start` | Reutiliza um agente da mesma versão/build com identidade comprovada ou inicia a instalação existente. |
| `--start "jpbiometria://start?ts=..."` | Abertura pelo aplicativo; somente a rota `start` é aceita. Parâmetros da URL não executam comandos. |

O reparo solicita a parada apenas de agentes que comprovem a posse da chave privada local. Se o SDK estiver em captura ou verificação, a parada é recusada e a mensagem pede aguardar. Não há `taskkill`, encerramento por nome, encerramento por porta ou encerramento forçado de agente sem resposta. O agente antigo e outros programas que ocupem uma porta são preservados; o novo agente pode usar outra porta do intervalo.

O instalador só informa que iniciou depois de verificar uma resposta autenticada do agente e conseguir consultar o status. A confirmação da instalação **não equivale a uma captura física** nem à confirmação de identidade de uma pessoa.

## HTTP e contrato com a interface

O servidor escuta somente em `127.0.0.1`, na primeira porta livre entre **8789 e 8799**. O aplicativo deve procurar a versão 12.8.1, inclusive quando um agente antigo continua na porta 8789.

As origens permitidas são exatamente:

- `https://www.jptreinamentos.com.br`
- `https://jptreinamentos.com.br`
- O próprio diagnóstico local em `http://127.0.0.1:PORTA` ou `http://localhost:PORTA`.

O agente também valida o endereço remoto, o cabeçalho Host e os métodos HTTP. Respostas não são armazenáveis em cache. Uma origem estrangeira ou opaca (`Origin: null`) não recebe acesso CORS. A captura exige POST e uma origem explicitamente permitida. A permissão de acesso à rede local do navegador é independente do CORS; se o navegador bloquear a solicitação, a interface deve orientar essa permissão sem desativar a segurança do navegador.

| Rota | Método | Contrato |
| --- | --- | --- |
| `/status`, `/debug/status` | GET | Status leve, com cache do SDK e atualização assíncrona. Campos `version`, `service`, `agent`, `buildSha`, `instanceId`, `port`, `ok`, `sdk`, `reader`, `deviceCount`, `busy`, `checking`, `errorCode`, `message`, `capabilities`. Não contém chave, template ou imagem. |
| `/api/capture`, `/capture` | POST | Captura real por SDK, imagem PNG em memória, sem template nem comparação biométrica. Content-Type `text/plain;charset=UTF-8` ou `application/json`. |
| `/api/signature`, `/verify` | POST | HTTP 501, `BIOMETRIC_MATCH_NOT_SUPPORTED`. Esta entrega não implementa comparação biométrica. |
| `/`, `/debug/capture` | GET | Diagnóstico local com CSP restrita e imagem somente na memória da página. |
| `/control` | POST | Controle exclusivo do inicializador, sem Origin de navegador, autenticado por HMAC e prova de resposta. Não é parte da API do aplicativo. |

Exemplo de captura da interface:

```json
{
  "cmd": "capture",
  "purpose": "test",
  "fingerCode": "R_INDEX",
  "agentFingerCode": "RIGHT_INDEX",
  "requireRealImage": true,
  "requireTemplate": false
}
```

`purpose` aceita `test` ou `signature`; ambos capturam uma imagem. `fingerCode` é o dedo que o operador selecionou, **não uma identificação anatômica comprovada pelo leitor**. A resposta explicita `fingerSelectionVerified:false` e `biometricVerified:false`. Não devolve `matched`, `matchScore`, `template` nem `templateHash`. Pedir um template produz HTTP 501. A interface não deve usar essa captura como prova de uma comparação com uma digital previamente cadastrada.

O agente Java anuncia `capabilities.capture:true`, `captureMethod:"POST"`, `capturePath:"/api/capture"`. A disponibilidade real exige também SDK e leitor detectados, `ok:true`, `busy:false` e `checking:false`. O diagnóstico sem Java anuncia `runtime:"diagnostic-only"` e `capture:false`; é um componente atualizado com uma dependência ausente, não um agente antigo.

Capturas simultâneas e concorrência com a consulta nativa do SDK são recusadas com HTTP 409. `/status` permanece responsivo durante uma captura, sem abrir outro acesso ao SDK. A chamada nativa recebe timeout de 15 segundos; não existe repetição automática de uma captura após falha ou timeout. Um SDK que ignore seu timeout pode exigir intervenção na estação; o inicializador não força sua interrupção.

### Identidade do processo local

`control.key` contém 32 bytes aleatórios em Base64 URL-safe. A chave não aparece em argumentos de processo, respostas HTTP, logs ou solicitações HTTP. Cada solicitação de controle contém HMAC-SHA256, timestamp e nonce. O servidor aceita uma janela de 30 segundos, recusa replay e responde com prova HMAC vinculada à solicitação, versão, build, instância e porta. O inicializador só reutiliza ou solicita a parada de uma instância depois de verificar essa prova. Cookies, credenciais do aplicativo e dados de trabalhadores não participam desse protocolo.

## Extração da imagem e limites

A integração usa os métodos e campos demonstrados no [exemplo Java do distribuidor FingerTech](https://github.com/FingerTechBR/DigitalparaWSQ/blob/1eba7c8cb83c540a65b2a09d737233338878581b/NBioAPI_WSQDemo.java):

1. `Capture(FIR_PURPOSE.VERIFY, FIR_HANDLE, timeout, auditHandle, windowOption)`.
2. `INPUT_FIR.SetFIRHandle(auditHandle)`.
3. `Export.ExportAudit(input, audit)`.
4. `audit.ImageWidth`, `audit.ImageHeight` e `audit.FingerData[0].Template[0].Data`.

O nome `Template` acima é o nome de um campo do formato de exportação de imagem do SDK. O agente **não exporta o FIR textual nem devolve um template biométrico ao aplicativo**. Handles e objetos exportadores são liberados ao encerrar a operação.

Somente esse caminho oficial é aceito. A imagem raw deve ter exatamente `largura × altura` bytes em escala de cinza, com dimensões entre 32 e 2048 pixels. Uma imagem já codificada em PNG/JPEG precisa ser realmente decodificável e ter dimensões internas iguais às dimensões do audit. As dimensões são lidas antes de decodificar a imagem, evitando alocação excessiva. Não há procura genérica por `byte[]` nem dimensão presumida de 248 × 292.

A conversão usa streams de memória; o cache em disco do ImageIO é desativado. O PNG final tem limite de 150 KiB. Nenhum dado de captura é gravado em log ou arquivo pelo código JP. Bibliotecas nativas do fabricante podem ter comportamento interno próprio; essa integração não certifica o armazenamento interno do SDK. Qualidade, quando disponível no cabeçalho oficial do FIR, é informada sem inventar uma pontuação quando o SDK não a fornece.

## Compilação e testes

Ferramentas do CI: **Java 17** com `jdk.compiler`, **Go 1.27.1** e Python 3. A compilação Java usa `--release 8`. O reparador Windows é compilado para `windows/amd64`, sem CGO. `GO_BIN` e `JAVA_BIN` podem apontar explicitamente para os executáveis locais.

Executar a partir da raiz do repositório:

```bash
python3 native/biometria/test_native.py
python3 native/biometria/build.py --output native/biometria/dist --build-sha COMMIT_SHA_COMPLETO
```

O teste funciona antes do build em um checkout limpo. Ele compila as fontes e um leitor sintético de teste, executa verificações HTTP/SDK-image no Java e testes do inicializador e do diagnóstico no Go. Gera um payload de produção separado e verifica a ausência de classes de teste e do fabricante. A lista das quatro fontes de produção está explícita em `build.py`.

O diretório de saída contém somente:

- `JP-Biometria-Setup-12.8.1.exe`
- `biometria-release.json`, com `version`, `buildSha`, `filename`, `sha256`, `sizeBytes` e metadados públicos da plataforma.

O JAR é reproduzível, com classes e timestamps fixados. Binários gerados não são versionados. O pipeline deve distribuir o mesmo par EXE/manifest que testou e verificar o SHA-256 e o commit antes da publicação.

### O que os testes comprovam

Os testes Linux cobrem origem/Host/métodos, preflight, requisições limitadas, controle HMAC e replay, recusa de shutdown durante captura, ausência de template/match no retorno, status durante captura, imagens sintéticas inválidas/oversize, arquitetura Java/DLL, protocolo e caminhos com espaços, chave persistente, substituição atômica, porta ocupada e preservação de processo desconhecido. A verificação do bytecode garante classe Java 8 e exclui o leitor sintético do pacote.

O teste Windows de instalação no CI, quando executado, verifica o EXE real, arquivos do usuário, registro HKCU, inicialização e reparo. A execução dele **não testa o hardware NITGEN**. Captura física, compatibilidade da versão instalada do SDK, solicitação de permissão no navegador e exibição da imagem no computador conectado ao leitor continuam sendo verificações necessárias na estação do usuário. Não há resultado de captura física registrado neste repositório.

## Fontes técnicas

- [Exemplo Java FingerTech de Capture, ExportAudit e imagem raw](https://github.com/FingerTechBR/DigitalparaWSQ/blob/1eba7c8cb83c540a65b2a09d737233338878581b/NBioAPI_WSQDemo.java).
- [Manual original eNBSP SDK, NITGEN, Rev. J](https://fingertech.com.br/download/EN_eNBSP_SDK_Programmer%27s_Guide_DC1-0017A_Rev_J.pdf).
- [FingerTech — desenvolvedores e suporte do fabricante](https://fingertech.com.br/desenvolvedores).
- [Chrome — Local Network Access](https://developer.chrome.com/blog/local-network-access).
- [Microsoft Edge — Local Network Access](https://learn.microsoft.com/en-us/deployedge/ms-edge-local-network-access).
