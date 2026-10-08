# EntregaEPI 12.9.2 — desempenho sem alterar a assinatura

## Evidência dos vídeos

O vídeo 20261008-0028 mostra tentativas que alternam entre localizar o leitor, solicitar o dedo e apresentar erro genérico do agente. Não mostra uma assinatura concluída. Portanto, não permite medir o tempo total de uma assinatura bem-sucedida nem identificar sozinho o erro do SDK. O vídeo 20261008-0030 mostra a captura no SOC avançando para geração do PDF. A referência é reduzir as esperas entre etapas e informar claramente a falha, preservando a conferência biométrica.

## Alterações

- A abertura da assinatura consulta somente a ficha escolhida e seu trabalhador, com dados atuais e as mesmas verificações de empresa e identidade. Não recarrega todas as fichas e todos os trabalhadores.
- A consulta ao leitor e a criação do desafio no servidor são independentes e executadas em paralelo. Nenhuma captura começa antes da conclusão positiva das duas. O desafio mantém validade, vínculo ao operador, trabalhador, empresa, ficha, dedo e versão.
- A busca prefere a porta conhecida; após 200 ms sem conclusão, procura também nas demais portas locais permitidas. Somente consultas GET de status são concorrentes. A captura não é repetida automaticamente; os sinais de cancelamento encerram as buscas.
- O catálogo de EPIs carrega em paralelo às empresas no início. Os trabalhadores e as fichas continuam dependendo da empresa selecionada. Diagnósticos e autenticação permanecem completos.
- O frontend reconhece o campo `errorCode` enviado pelo agente Java, além de `code`. Divergência, computador diferente, leitor ocupado e erros conhecidos do SDK recebem mensagens específicas. Mensagens arbitrárias, templates e dados privados não são exibidos.

## O que permanece

Escolha do dedo, captura física, comparação NITGEN, prova assinada, recusa de divergência, expiração, proteção contra alteração concorrente, isolamento de empresas, bloqueio de empresas excluídas, impressão, cadastro de digitais e exclusão de fichas. Não há assinatura por imagem, assinatura antecipada ou reutilização de uma captura anterior.

## Validação

API e testes unitários verificam autorização da consulta pontual, identidade atual, cancelamento, busca em porta alternativa sem esperar o timeout principal e erros do protocolo Java. O navegador integrado valida captura recusada quando a preparação no servidor falha, divergência, assinatura positiva, impressão, edição e exclusão.

O ensaio antes/depois usa o mesmo navegador, a mesma API local e latência sintética fixa (180 ms por serviço, catálogo 500 ms, autenticação 80 ms). Os tempos não representam promessa para o leitor físico. As alterações de desempenho funcionam com o agente 12.9.1; o pacote 12.9.2 mantém o mesmo algoritmo NITGEN.

### Resultado do ensaio controlado

| Etapa | 12.9.1 | 12.9.2 | Redução observada |
| --- | ---: | ---: | ---: |
| Login, carga inicial e diagnósticos | 852 ms | 650 ms | 24% |
| Abrir caixa de assinatura com dados atuais | 826 ms | 311 ms | 62% |
| Preparar tentativa antes da chamada de captura | 387 ms | 210 ms | 46% |

Medição local com Chromium 151, API real em memória e leitor/Cognito simulados. Uma execução completa por versão, sob as mesmas latências configuradas; os percentuais são arredondados. A etapa de preparação exclui a latência artificial do próprio POST de captura. Nenhum resultado mede a velocidade física do sensor. Os dois fluxos completaram as 15 verificações integradas, incluindo as recusas de preparação e de digital divergente. API: 117 testes. Unidade frontend: 75 testes. Infraestrutura: 34 testes.
