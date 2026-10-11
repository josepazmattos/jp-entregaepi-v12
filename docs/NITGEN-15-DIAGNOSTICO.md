# Diagnóstico reproduzível — NITGEN_15

Data: 10/10/2026, horário de Cuiabá. Produto: JP EntregaEPI / JP Biometria.

## Resultado confirmado

Ao investigar o aviso informado pelo usuário (agente respondeu, mas não confirmou leitor pronto), o runtime usado pelo instalador retornou `NITGEN_15` em Windows limpo no GitHub Actions, sem leitor físico e sem certificados ou digitais reais. Nesse ambiente, o agente HTTP responde, mas a inicialização do SDK Java falha. A causa exata no computador do cliente ainda precisa ser confirmada. O teste do pacote completo bloqueia a publicação da 12.10.1.

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

### Verificação dos novos arquivos enviados em 10/10/2026

O executável dentro de `eNBioBSP_v5.2.0.6_Windows (1).zip` é idêntico ao executável anterior: 280.375.104 bytes, SHA-256 `f97a7249ecacc7feaeb2da776d3f4fab9f7122c1b0a36575cf129747eb0fb6b5`. Não é uma atualização de runtime.

O `Java.zip` contém exemplos e duas versões diferentes de `NBioBSPJNI.jar`. Foram selecionados apenas os componentes do fabricante; imagens, templates biométricos, dados dos exemplos e serial não foram publicados ou incluídos nos testes.

| Teste adicional no Windows x64 sem leitor | Resultado |
|---|---|
| JAR do exemplo IndexSearch, 3 combinações de diretório/carregador | Inicialização 15 nos 3 casos |
| JAR do exemplo Busca 1-N, 3 combinações de diretório/carregador | Inicialização 15 nos 3 casos |
| JAR original com NSearch.dll do System64 original, 3 combinações | Inicialização 15 nos 3 casos |
| Entrada pública C `NBioAPI_Init`, com dependências originais | Inicialização 15 |
| Certificado sintético A1, Java privado do instalador | 108 verificações aprovadas |

Hashes dos componentes adicionais:

- IndexSearch JAR: `823550c6acf7cd3ac3b0fd1a6b2199576e0c6fe5b95ae4697a2f0433a4209fb6`.
- Busca 1-N JAR: `f72e671384656db384f58ee70632ddaa5b9f85abac06c00d2d1232066f7c19d5`.
- NSearch.dll x64: `69b6ba791fe2e8fa226de49ab4b85567ab3b996d1e400604d283cb87b6dd1dbc`.

[Logs da verificação dos anexos](https://github.com/josepazmattos/jp-entregaepi-v12/actions/runs/38102546907/job/114361299535). A execução registrou todos os resultados acima; depois, a limpeza temporária falhou porque o processo Python ainda mantinha a DLL carregada. O diagnóstico C foi movido para um processo separado para liberar a DLL no encerramento. Nenhuma verificação de validação do SDK foi alterada.

Conclusão limitada ao ambiente testado: trocar o JAR ou acrescentar NSearch.dll não resolve a recusa. A falha também ocorre na API C, portanto não é exclusiva do adaptador Java do aplicativo. Não foi testado o instalador interativo do fabricante, com serial, em um computador com o Hamster DX conectado. A execução do demo oficial nesse computador é o próximo passo para distinguir configuração local de incompatibilidade do runtime/ambiente.

### Dados para o suporte

Solicitamos a análise de `NBioAPIERROR_VALIDITY_FAIL (15)` na inicialização Java com os componentes acima e um conjunto de runtime x64 compatível com o Hamster DX HFDU06, incluindo JAR/JNI/DLLs correspondentes. Favor informar os pré-requisitos de implantação e de validação aplicáveis ao runtime e o procedimento oficial para instalação automatizada em máquinas de clientes. O objetivo é um pacote único, preservando as verificações do fabricante.

Portal oficial: https://suporte.fingertech.com.br/devs-download-sdk/ (exige conta do fornecedor). Suporte ao desenvolvedor: https://suporte.fingertech.com.br/portal-do-desenvolvedor/.

## Correções já preparadas no aplicativo

- Diagnóstico específico para NITGEN_15 e versão expirada NITGEN_24.
- Ausência de USB não mascara falha de validação do SDK.
- Configuração do certificado digital independente do leitor.
- Provas biométricas continuam exigindo correspondência real; nenhuma falha é convertida em assinatura ou prontidão.

Não foi feita alteração, remoção ou contorno da validação NITGEN. A causa específica dessa recusa ainda não foi determinada. Leitor físico, certificado real do cliente e publicação da nova versão permanecem pendentes.

Referência: [manual Java NITGEN](https://fingertech.com.br/download/EN_eNBSP_SDK_for_Java_Programmer%27s_Guide_DC1-0085A.pdf), seção NBioBSPJNI.ERROR.
