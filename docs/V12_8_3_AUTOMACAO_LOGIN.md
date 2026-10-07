# 12.8.3 — Verificações automáticas após o login

Master e cliente iniciam a mesma rotina após autenticação concluída, inclusive
quando uma sessão válida é restaurada ao recarregar a página. Troca de senha
obrigatória precisa terminar antes. Atualizar cadastros, navegar ou selecionar
outra empresa não dispara novas rotinas.

## Comportamento

- `/health` confirma conexão, persistência durável e leitura do armazenamento.
  Não cria cadastros fictícios para testar gravação. Limite de 12 segundos.
- `/api/caepi/365` consulta a base instalada e mostra sua data real de obtenção.
  O resultado não representa uma consulta ao vivo nem atualiza a base do MTE.
  Ausência, ambiguidade e base complementar são sinalizadas. Limite de 12 segundos.
- A biometria consulta apenas `/status`, nas portas já suportadas 8789–8799.
  Com permissão de loopback concedida, procura o agente e o leitor automaticamente.
  Sem permissão confirmada, oferece uma ação explícita para o primeiro acesso.
- No Windows, agente ausente ou diagnóstico recuperável de Java/SDK recebe uma
  única solicitação `jpbiometria://start` por verificação. Após a solicitação,
  aguarda e repete a descoberta com prazo limitado. O navegador pode pedir uma
  confirmação de abertura. Nunca interpreta enviar o protocolo como conexão pronta.
- “Iniciar JP Biometria” também verifica a conexão depois da abertura; não exige
  clicar separadamente em “Verificar leitor”. SDK ausente permanece identificado.
- O Dashboard mostra andamento e resultados independentes, sincronizados com as
  telas detalhadas. Falhas não bloqueiam as outras verificações ou a navegação.
- Logout cancela os pedidos e invalida respostas anteriores. JWT e empresa não
  são enviados ao serviço local. Nenhuma captura ou gravação biométrica ocorre
  durante login. A captura segue na ação explícita do teste ou da ficha.

A implementação segue a orientação do Chrome para iniciar automaticamente
conexões de loopback somente após permissão concedida:
https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/local-network-access.md

## Evidências e limites

`tests/frontend-startup-browser.cjs` executa o aplicativo em Chromium com Cognito,
API e agente sintéticos. Cobre Master, cliente, sessão restaurada, primeiro acesso,
permissões, início do agente, SDK ausente, armazenamento indisponível, CA ambíguo,
limite de tempo, logout e resposta tardia. Gera resultados JSON e imagens desktop/
mobile em `tests/output/startup`, identificadas como demonstrações simuladas.

As suítes existentes verificam o isolamento das empresas, captura, cancelamento,
registro na ficha e impressão. O workflow exige os testes e a instalação do
executável no Windows antes de publicar na produção. A versão mantém compatibilidade
com o agente 12.8.1 ou posterior; não exige reinstalação para ativar o novo painel.

Os testes de Windows e navegador não comprovam captura física pelo leitor USB
do usuário. É necessário SDK eNBioBSP Java, Java compatível e leitor conectado.
