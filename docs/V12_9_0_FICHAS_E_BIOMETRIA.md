# EntregaEPI 12.9.0

## Uso

O Dashboard mantém a verificação automática após login, com três indicadores pequenos: Sistema, CA e Biometria. Clique em qualquer um para consultar os detalhes em Sistema → Configurações. O indicador sinaliza a disponibilidade informada pelo serviço; uma leitura física ainda exige captura. O CA permanece uma cópia oficial datada e não é anunciado como consulta ao vivo.

Em Trabalhadores, selecione a empresa no cabeçalho (Master), use **Editar** para revisar os dados e **Digitais** para cadastrar previamente um dedo. O cliente continua limitado à própria empresa. Os templates ficam no banco do sistema, separados das listagens, vinculados ao trabalhador e à empresa. O painel mostra somente os dedos cadastrados e abre os controles quando necessário.

Gere a ficha em Entrega de EPI. Em Fichas, cada documento ocupa uma linha com situação, **Imprimir** e **Excluir**. Imprimir abre uma nova aba com os botões **Assinar biometricamente** e **Imprimir**. O primeiro abre a seleção dos dedos cadastrados na própria aba. O leitor captura uma nova digital e o SDK NITGEN compara com o template selecionado. Divergência, ausência de cadastro, falta de permissão, alteração concorrente ou falha de conexão impedem a conclusão. Os botões não aparecem no papel/PDF.

Novas fichas gravam o nome curto do equipamento. O campo **Nome do equipamento na ficha** é separado da descrição técnica do CA. Registros anteriores sem nome curto recebem uma apresentação abreviada, preservando o dado original. As fichas mantêm o termo integral e os dados da época da emissão. Um registro antigo sem comparação pode receber uma nova validação; a assinatura anterior é preservada separadamente.

Excluir uma ficha pendente remove o rascunho. Excluir uma ficha assinada exige motivo e cancela o documento, preservando o histórico. Use **Mostrar fichas canceladas** para consultá-lo.

Em Empresas, **Editar** atualiza nome, localidade, UF, responsável, telefone e e-mail. CNPJ e login permanecem vinculados ao acesso existente. Os cadastros utilizam controle de versão para impedir sobrescrita silenciosa.

## Componente local e limites

Instale o componente **JP Biometria 12.9.0** disponível em Sistema → Biometria para habilitar cadastro e comparação. A atualização do site não executa instaladores no computador do usuário. O reparador preserva o SDK e a chave local.

Nesta versão, o template é vinculado à chave da estação que realizou o cadastro. Para usar outra estação, recadastre a digital nela. A chave local é preservada entre reinícios e reparos. Não foram realizados testes com o leitor USB físico nesta atualização; os testes automatizados usam leitor e imagens sintéticos.

## Verificação

- Backend: desafios, prova criptográfica, vínculo empresa/trabalhador/ficha, dedo cadastrado, recadastro concorrente, expiração, replay, mismatch, edição e exclusão.
- Java/Go: protocolo HTTP local, origem/Host, captura de diagnóstico isolada, cadastro, comparação positiva/negativa sintética, prova ECDSA e persistência da chave, instalação e reparo.
- Navegador: interface com Lambda real e armazenamento em memória; apenas Cognito e leitor simulados. Cadastro prévio, emissão, mismatch, assinatura positiva, PDF A4, nome curto, edição, cancelamento, troca de empresa e largura móvel.
- Publicação: workflow testa o commit, compila o instalador, verifica a instalação no runner Windows sem leitor e só depois implanta na AWS com backup e verificação dos arquivos.
