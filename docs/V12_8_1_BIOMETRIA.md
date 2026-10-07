# V12.8.1 — conexão do leitor NITGEN e captura na ficha

## Objetivo e limites da verificação

A versão corrige a comunicação do aplicativo com o componente local do leitor
NITGEN. O diagnóstico apresentado pelo usuário reconhece o **Hamster HFDU06** e
mostra uma captura no utilitário do fabricante. Isso comprova o funcionamento
naquele utilitário; não comprova que o componente Java esteja instalado,
iniciado e acessível ao navegador.

Os testes desta atualização usam imagens e leitores sintéticos. A captura USB
real depende do Windows conectado ao equipamento e precisa ser conferida nesse
computador. Nenhuma digital fornecida pelo usuário integra código, testes,
exemplos ou artefatos públicos.

## Como reparar e usar

1. Conecte o leitor USB e feche o utilitário de diagnóstico NITGEN para liberar
   o equipamento.
2. No aplicativo, abra **Biometria → Instalar / reparar JP Biometria** e execute
   `JP-Biometria-Setup-12.8.1.exe` no Windows que está conectado ao leitor.
3. Abra **Iniciar JP Biometria**. Confirme a abertura do aplicativo instalado
   se o navegador apresentar essa solicitação.
4. Clique em **Verificar leitor**. Permita a conexão local para o site
   `https://www.jptreinamentos.com.br` quando o navegador solicitar.
5. Use **Testar captura**, selecione o dedo e clique em **Capturar digital**.
   A imagem aparece na prévia e é descartada ao fechar esse teste.
6. Para registrar uma entrega, abra **Fichas de EPI**, escolha uma ficha
   pendente e clique em **Capturar digital**. Confira empresa, trabalhador e
   ficha, faça a captura e use **Registrar captura na ficha**.

O driver NITGEN existente é preservado. O reparador usa Java e o SDK eNBioBSP
instalados no computador; ele não baixa nem substitui automaticamente esses
componentes. O SDK deve conter `NBioBSPJNI.jar`, `NBioBSP.dll` e
`NBioBSPJNI.dll`, com arquitetura compatível com o Java selecionado. Somente o
driver/diagnóstico do Windows não garante a presença dessas bibliotecas Java.

Aplicativo: https://www.jptreinamentos.com.br/EntregaEPI/?v=1281

Instalador: https://www.jptreinamentos.com.br/EntregaEPI/assets/JP-Biometria-Setup-12.8.1.exe

Manifesto do componente: https://www.jptreinamentos.com.br/EntregaEPI/assets/biometria-release.json

## Correções implementadas

| Situação anterior | Comportamento da V12.8.1 |
| --- | --- |
| Consulta fixa à porta 8789, com mensagem genérica `Failed to fetch`. | Descoberta limitada às portas 8789–8799 do próprio computador, com diagnóstico de conexão, versão, SDK e leitor. |
| Uma resposta HTTP bem-sucedida podia ser interpretada como leitor disponível. | Exige identidade do componente, versão compatível, capacidade de captura, SDK disponível e leitor detectado. |
| O componente antigo podia encerrar o próprio launcher ao tentar iniciá-lo. | Inicialização controla somente a instância reconhecida pelo componente novo; não encerra processos genéricos nem ocupantes desconhecidos das portas. |
| A porta de uma versão antiga podia impedir o uso da nova. | O componente escolhe uma porta livre da faixa e o aplicativo prefere uma versão compatível. |
| Captura e confirmação não estavam disponíveis no fluxo da ficha. | Seleção do dedo, prévia e confirmação separada na ficha pendente. |
| Reenvio após perda de resposta podia produzir confirmação incerta. | A mesma captura conserva seu identificador para repetir o registro com segurança, sem duplicar a gravação. |

A versão 11.10.6 e outros componentes anteriores à 12.8.1 servem apenas para
diagnóstico nesta interface. O aplicativo solicita atualização antes de fazer
novas capturas. O botão de inicialização apenas solicita a abertura; a indicação
de leitor disponível depende da resposta posterior do serviço.

## Conexão e privacidade dos dados

O serviço escuta somente `127.0.0.1`, nas portas 8789–8799. Valida Host, origem
e método. Captura usa `POST /api/capture`; `GET` consulta o status. O aplicativo
não envia token Cognito, senha, empresa, nome ou matrícula do trabalhador ao
serviço local. O controle de inicialização/encerramento usa uma chave local
privada que não aparece nas respostas do navegador.

As consultas começam por ação do usuário. A descoberta tem prazo total de
20 segundos; o diagnóstico assíncrono do SDK aguarda até 8 segundos e a captura
aguarda até 35 segundos no navegador. Timeout ou erro de rede não provocam nova
captura automática. Status e captura respeitam o uso exclusivo do SDK.

A imagem deriva dos dados de auditoria exportados pelo SDK:
`Export.AUDIT.ImageWidth`, `ImageHeight` e
`FingerData[0].Template[0].Data`. Pixels brutos precisam corresponder exatamente
às dimensões retornadas. O componente não inventa dimensões nem transforma
templates em imagens. O resultado é PNG validado, com até 150 KB. Não há gravação
de imagens em disco pelo componente, envio de templates ou logs de digitais.

Antes da confirmação, a prévia fica somente na memória da página. Fechar, sair
ou trocar de empresa descarta a imagem e invalida respostas atrasadas. Depois
de iniciar o envio à API, fechar a janela não desfaz uma gravação que o servidor
possa ter concluído; a interface orienta a consultar a ficha.

## Registro da ficha

O servidor mantém a autorização por empresa e atribui autor, data e identificador
do registro. Aceita apenas imagens PNG/JPEG válidas, com tamanho limitado. Não
aceita como prova de identidade os campos `matched`, `matchScore` ou
`verificada` enviados por um cliente. O registro é explicitamente uma
**captura de imagem**, sem comparação automática da identidade biométrica.

O identificador de repetição fica vinculado à mesma ficha, autor, dedo e bytes
da imagem. Uma confirmação diferente ou uma ficha alterada permanece protegida
contra sobrescrita. Operações concorrentes preservam a condição de escrita no
banco. Fichas de outras empresas não são acessíveis pela captura.

O modelo aprovado mantém nome, função, matrícula eSocial completa e tipo da
movimentação, com o **Termo de Responsabilidade antes da relação dos EPIs**.
Matrículas continuam textuais, alfanuméricas e sem limite de negócio por campo.

## Distribuição e evidências

O código-fonte do componente está em `native/biometria/`. O GitHub Actions testa
o serviço com leitor sintético, compila Java para versão 8 e gera o launcher
Windows de 64 bits. O manifesto informa versão, commit, nome, tamanho e SHA-256.
Somente o instalador e o manifesto aprovados na mesma execução podem ser
publicados. As bibliotecas proprietárias NITGEN não são redistribuídas.

O executável desta compilação não contém assinatura Authenticode. A identificação
dos bytes distribuídos é feita pelo SHA-256 e pelo commit no manifesto público.

O mesmo executável passa por instalação, inicialização e reparo em um runner
Windows, usando uma pasta temporária com espaços. O teste verifica o protocolo,
o registro do usuário, a instância autenticada e sua limpeza. O runner não tem
leitor NITGEN e deve informar SDK ausente. Esse job também precisa ser aprovado
para autorizar a publicação; ele não comprova captura USB.

A identificação final pode ser conferida em
https://www.jptreinamentos.com.br/EntregaEPI/version.json . Esse documento também
inclui o hash do instalador. O resultado do workflow e as evidências sintéticas
identificam o commit testado. A aprovação automatizada não substitui o teste USB
no computador do usuário.

Referências técnicas consultadas:

- Exemplo Java NITGEN/FingerTech, `ExportAudit`:
  https://github.com/FingerTechBR/DigitalparaWSQ/blob/1eba7c8cb83c540a65b2a09d737233338878581b/NBioAPI_WSQDemo.java
- Orientação oficial do Chrome para acesso local:
  https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/local-network-access.md

As permissões de acesso local dependem do navegador. A integração conserva CORS
e trata a API de permissão como recurso opcional; não requer desativar a
segurança do navegador.
