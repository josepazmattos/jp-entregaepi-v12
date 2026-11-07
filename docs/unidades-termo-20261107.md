# Unidades e termo de EPI — publicação de 07/11/2026

Frontend e identificação da API: `d8f6752b2e7aa7a77501e80fcb5fa4b05c732329`. Código API: `9c02e3e875f2f85a017bd5f31cca276c85a4750d`. Novo termo/renderização: `95d985b0f9340f456f17b99a41a998deeb3a547f`. Integração JP Treinamentos publicada pelo workflow de main: `20076a81fffb904aa1a47860cf94307dd6673870`.

## Comportamento

- Entrega comum e entrega rápida oferecem Localidade / unidade. A opção mostra cidade/UF e endereço; abaixo aparecem endereço e CEP para conferência. Sugestão apenas quando a localidade do trabalhador encontra uma unidade única ou existe uma única unidade disponível.
- Associação exclusivamente pelo CNPJ exato, limitada às empresas autorizadas na sessão. O navegador não escolhe o CNPJ da consulta. Localidades inativas são excluídas pela origem. Dados incompletos não são inventados.
- A ficha guarda endereço, cidade, UF, CEP, identificadores de origem e versão da unidade dentro de empresaSnapshot; esses dados participam do hash confirmado pelo trabalhador. Mudanças cadastrais não reescrevem fichas emitidas.
- Consulta iniciada somente ao abrir a entrega ou clicar em Atualizar unidades. Cache durável de 24 horas por empresa e reaproveitamento na sessão, sem consulta externa durante login/impressão. Sem filas, cron ou serviços permanentes adicionais.
- JP Treinamentos expõe apenas uma consulta IAM interna parametrizada de empresas/localidades. Não há nova rota HTTP pública nem acesso do EPI às credenciais do banco central.
- Alterações de versão da localidade entre a seleção e a emissão exigem nova conferência. Reenvio de entrega rápida inclui unidade e versão na idempotência.

## Inicialização e conferência

Todas as 10 empresas ativas já cadastradas no EPI foram consultadas. Nove correspondências ativas no JP Treinamentos, com 20 localidades. JP CONSULTORIA EM SEGURANCA DO TRABALHO LTDA (CNPJ 32727413000169) não teve correspondência ativa; mantém o endereço do cadastro EPI. Nenhum cadastro de acesso ou senha foi criado/alterado.

IVR: cinco localidades. Sidrolândia preserva MS e CEP 79170-000 a partir do endereço explícito, mesmo com diferença de acento entre os campos. Aquidauana possui CEP incompleto no endereço de origem; não foi completado automaticamente. A função temporária de inicialização foi removida; relatório privado preservado junto ao backup.

## Termo

Modelo `JP-EPI-2026.11-v2`: seis itens solicitados, abertura de movimentações, cláusulas complementares compatíveis e confirmação eletrônica. Ajustes jurídicos: obrigação de uso durante a exposição aplicável; limpeza/guarda/conservação do trabalhador, preservando higienização/manutenção a cargo da empresa; recusa injustificada como ato faltoso e sanções dependentes de apuração. Corrigida duplicação de 'contrato de contrato'. Declaração de treinamento integra o conteúdo a ser conferido e assinado; não cria certificado nem registro fictício de treinamento. Documentos anteriores conservam o conteúdo que foi assinado. Sem a frase de orientação não informada. Admissão DD/MM/AAAA e parágrafos justificados mantidos.

Referências: CLT art. 158 e 166; NR-6 vigente (Portaria MTE 57/2025), itens 6.5.1, 6.6.1 e 6.7.2.

## Validação

CI EPI 42421339989 aprovado: testes de backend, frontend e Chromium (unidades, vales, entrega rápida/relatórios). CI Treinamentos 42419838418: testes e publicação aprovados. Consulta IAM de produção, cache das dez empresas, UF/CEP de Sidrolândia, HTML nas três entradas públicas, arquivo do seletor e saúde da API conferidos. PDF sintético revisado visualmente; nenhum novo documento de trabalhador nem e-mail real foi produzido nos testes.
