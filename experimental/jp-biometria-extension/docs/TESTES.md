# JP Biometria — resultado do piloto 0.1.0

Data: 12/10/2026. Ambiente de desenvolvimento Linux; Go 1.27.2 e Node 24.19.0.

## O que foi verificado

| Verificação | Resultado | Alcance |
| --- | --- | --- |
| Testes Go do conector | Aprovados, inclusive com detector de corridas (`-race`) | Protocolo nativo, limites, origem da extensão, prova HMAC, status, captura e respostas inválidas |
| `go vet` | Aprovado | Análise estática do conector |
| Integração HTTP local | Aprovada com agente simulado | Descoberta autenticada em portas fixas, status e retorno de PNG sintético; nenhum leitor físico |
| 12 testes JavaScript | Aprovados | Permissões, comandos, domínio/rota, proteção de respostas, estados, clique repetido e limpeza da imagem no DOM |
| Atualização assíncrona de status | Aprovada em simulação | Aguarda brevemente a verificação inicial do agente, com limite de tempo |
| Compilação Windows | Aprovada | Gerado EXE PE32+ GUI x86-64; compilação cruzada, sem execução no Windows |
| Modelo visual offline | Estrutura e scripts verificados | HTML autocontido com cenários simulados; sem carregamento de código externo |
| Navegador real | Pendente | Chromium foi bloqueado pela política de execução deste ambiente. Não houve validação visual ou de instalação no navegador |
| Instalação Windows / registro | Pendente | Precisa de teste em máquina Windows x64, Chrome e Edge |
| NITGEN físico / velocidade | Pendente | Precisa de Hamster DX conectado, driver manual e agente JP funcionando |

O teste local simulado mede somente o código de comunicação. Não permite afirmar que a captura real será instantânea ou mais rápida que o SOC.

## Bloqueios confirmados nos testes

- Comandos de certificado, cadastro, desligamento e URLs/rotas arbitrárias não passam pelo protocolo.
- Campos desconhecidos, entradas excessivas, JSON inválido e dedo inválido são rejeitados.
- Resposta sem prova HMAC válida ou com identidade divergente do agente não é aceita.
- Um status de SDK ausente, leitor ocupado ou leitor indisponível não habilita a captura.
- A chamada de captura tem finalidade fixa de teste e não é repetida automaticamente.
- Imagem ausente, formato diferente de PNG, tamanho excessivo e PNG corrompido são rejeitados.
- Templates, chaves e dados de certificados não são encaminhados ao painel.
- O painel não faz leitura ao abrir. A imagem é removida ao limpar, fechar ou vencer seu tempo de exibição.

## Teste assistido necessário no Windows

1. Confirmar o driver manual e o funcionamento do agente JP existente antes de instalar o piloto.
2. Carregar a extensão e executar o conector no mesmo usuário do Windows. Reabrir o navegador se necessário.
3. Clicar em Verificar leitor. Conferir a mensagem quando o agente está aberto e quando está fechado.
4. Testar leitor conectado, desconectado e ocupado pelo diagnóstico NITGEN. Fechar o diagnóstico antes de capturar.
5. Iniciar uma captura de teste. Conferir a imagem e a limpeza ao fechar o painel. Não associar a captura a um trabalhador.
6. Repetir no Chrome e no Edge, verificando bloqueios por políticas corporativas. Não desativar proteções do Windows.
7. Cronometrar verificação e captura em várias tentativas, sem confundir tempo da interface com tempo do sensor.
8. Desativar o conector piloto e confirmar que o agente JP e o fluxo anterior continuam funcionando.

## Condição de distribuição

Este é um piloto de diagnóstico e captura, sem assinatura de distribuição do executável e sem publicação nas lojas. Não é o instalador completo para computadores novos, não instala o SDK e não substitui a assinatura de fichas no site. Certificados, cofre, digitais cadastradas e arquivos de produção foram preservados.
