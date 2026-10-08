# EntregaEPI 12.9.3 — recadastro e imagem da captura

O vídeo de 07/10 mostra a confirmação de cadastro seguida de cartões sem imagem e um botão Concluído desabilitado. O fluxo anterior ainda aceitava cadastros do agente antigo sem fotografia e o botão Recadastrar apenas selecionava o dedo.

## Correções

- Recadastrar seleciona o dedo e inicia a nova operação, após confirmação de substituição. Ao concluir, Cadastrar outra digital e Recadastrar continuam disponíveis.
- Novos cadastros e recadastros exigem imagem real da mesma captura, vinculada à prova assinada. Um envio sem imagem é rejeitado sem alterar a digital existente. Cadastros históricos permanecem válidos para comparação.
- O site reconhece o agente com suporte à imagem (12.9.1 ou superior) e oferece atualização quando necessário, antes de iniciar captura. Se versões antigas e novas estiverem em portas diferentes, procura o agente compatível.
- A imagem confirmada pelo servidor atualiza o cartão diretamente. Foram eliminadas as duas consultas completas de trabalhadores e galeria após cada gravação. Uma resposta antiga da galeria não substitui a imagem recém-salva.
- O componente local mantém por até cinco segundos o diagnóstico após uma operação biométrica bem-sucedida, evitando reabrir o SDK imediatamente. A captura seguinte continua executando a leitura física; falhas invalidam o diagnóstico. Não há reutilização de captura para assinar.

## Uso

Instale o **JP Biometria 12.9.3** pelo link do aviso ou por Sistema → Biometria → Instalar / reparar. Depois abra Trabalhadores → Digitais → Recadastrar, confirme a substituição e faça a leitura. A confirmação final informa que a imagem foi salva e o cartão exibe a fotografia para conferência visual. As imagens anteriores que nunca foram armazenadas exigem nova captura; não são reconstruídas a partir do template.

## Testes

- API: imagem ausente ou adulterada não substitui o cadastro; resposta da gravação inclui somente imagem, dedo e data além do trabalhador, sem expor template. Permanecem testes de autorização, divergência, expiração e versões concorrentes.
- Navegador integrado: agente antigo bloqueado antes da captura, link de atualização, dois recadastros sucessivos no mesmo diálogo, imagem persistida e exibida, botões disponíveis e nenhuma consulta extra à listagem/galeria após salvar.
- Java: 79 verificações com leitor sintético, incluindo ausência de nova sondagem do SDK imediatamente após cadastrar.
- A implantação continua condicionada aos testes de código, navegador e instalação/reparo no Windows.

A leitura física do sensor deve ser conferida no computador do usuário. O teste automatizado não utiliza SDK NITGEN instalado nem digitais reais e não mede o tempo físico de reconhecimento.
