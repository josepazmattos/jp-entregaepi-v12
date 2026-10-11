# Diagnóstico reproduzível — NITGEN_15

Data: 10/10/2026, horário de Cuiabá. Produto: JP EntregaEPI / JP Biometria.

## Resultado confirmado

O instalador 12.10.0 informado pelo usuário retorna `NITGEN_15`. A mesma falha foi reproduzida em Windows limpo no GitHub Actions, sem leitor físico e sem certificados ou digitais reais. O agente HTTP responde, mas a inicialização do SDK Java falha. O teste do pacote completo bloqueia a publicação da 12.10.1.

O SDK oficial define `NBioAPIERROR_VALIDITY_FAIL = 0x0f`, ou 15 decimal. Esse resultado não comprova leitor ocupado, driver ausente nem uma causa específica de licença.

## Reprodução independente do aplicativo

Exemplo mínimo usando `NBioBSPJNI.jar` do mesmo pacote, construtor público `new NBioBSPJNI()` e `GetErrorCode()`, sem solicitar captura e sem modificar bibliotecas do fornecedor:

| Condição | Inicialização |
|---|---|
| Diretório do agente, DLL principal carregada por caminho absoluto | 15 |
| Diretório das DLLs do SDK, DLL principal por caminho absoluto | 15 |
| Diretório do SDK, carregador padrão Java com library.path e PATH corretos | 15 |

Ambiente: runner Windows x64; Java privado Temurin 8u504-b01 x64, incluído no pacote. Todos os casos terminaram normalmente e retornaram 15 antes da enumeração do leitor.

Evidência: [execução isolada do SDK](https://github.com/josepazmattos/jp-entregaepi-v12/actions/runs/38101395539/job/114357910819).

## Componentes conferidos

eNBioBSP 5.2.0.6 fornecido para esta integração. As cópias x64 das pastas Bin e System64 do pacote original têm hashes idênticos:

| Arquivo | SHA-256 |
|---|---|
| NBioBSP.dll | `21239165979328223abea3e9d64e35e08969faf786ef97740226e7e65d5901a8` |
| NBioBSPJNI.dll | `d3909124c28be5fe13260ad0239f0bf69ae1a959c77c42c118e32fba3edd0c37` |
| NBioBSPJNI.jar | `4d03b6eea2ff806f990129c2f28d8e03508e48faab5b313574834694bcbabe8e` |

## Solicitação técnica à NITGEN / FingerTech

Solicitamos a análise de `NBioAPIERROR_VALIDITY_FAIL (15)` na inicialização Java com os componentes acima e um conjunto de runtime x64 compatível com o Hamster DX HFDU06, incluindo JAR/JNI/DLLs correspondentes. Favor informar os pré-requisitos de implantação e de validação aplicáveis ao runtime e o procedimento oficial para instalação automatizada em máquinas de clientes. O objetivo é um pacote único, preservando as verificações do fabricante.

Portal oficial: https://suporte.fingertech.com.br/devs-download-sdk/ (exige conta do fornecedor). Suporte ao desenvolvedor: https://suporte.fingertech.com.br/portal-do-desenvolvedor/.

## Correções já preparadas no aplicativo

- Diagnóstico específico para NITGEN_15 e versão expirada NITGEN_24.
- Ausência de USB não mascara falha de validação do SDK.
- Configuração do certificado digital independente do leitor.
- Provas biométricas continuam exigindo correspondência real; nenhuma falha é convertida em assinatura ou prontidão.

Não foi feita alteração, remoção ou contorno da validação NITGEN. A causa específica dessa recusa ainda não foi determinada. Leitor físico, certificado real do cliente e publicação da nova versão permanecem pendentes.

Referência: [manual Java NITGEN](https://fingertech.com.br/download/EN_eNBSP_SDK_for_Java_Programmer%27s_Guide_DC1-0085A.pdf), seção NBioBSPJNI.ERROR.
