# Acesso biométrico autorizado pelo login

Esta atualização substitui a autorização manual de computadores introduzida em 12.10.0-bio2. O usuário solicitou que o login da empresa fosse a autorização suficiente para acessar os cadastros e usar o leitor local.

## Fluxo

O usuário entra normalmente. O aplicativo identifica o agente local, obtém sua chave pública quando o agente oferece esse recurso e solicita o desafio para a ficha. O servidor verifica a sessão, o perfil e o vínculo da empresa antes de disponibilizar o template do trabalhador/dedo selecionado. A captura é comparada pelo SDK NITGEN existente. A resposta precisa corresponder ao desafio, à chave escolhida, ao trabalhador, dedo, ficha, conteúdo, template e imagem. Divergência, expiração e adulteração continuam bloqueadas.

Não há formulário de nome do computador, senha Master adicional, lista de computadores ou registro de autorização de máquina. Registros históricos dessa função não são apagados nem usados para bloquear a política de acesso atual. O certificado permanece no cofre da empresa, com suas permissões administrativas anteriores. Nenhum arquivo nativo, driver, SDK, instalador ou código de certificação foi alterado nesta correção.

## Compatibilidade real

O agente 12.10.0-bio2 já publicado permite obter automaticamente sua identidade pública e usar os cadastros compartilhados após o login. Não exige uma nova atualização do agente para esta correção do site.

O agente 12.10.0-bio1 e versões anteriores continuam funcionando no computador cujo cadastro já reconhecem. Essas versões não expõem a identidade necessária ao compartilhamento e bloqueiam templates vinculados a outro agente internamente. Uma alteração apenas no site não modifica esse executável já instalado. Para usar uma dessas versões antigas com cadastros de outra máquina, ainda é necessário atualizar o componente local uma vez; o navegador não instala programas silenciosamente. Isso não exige recadastrar digitais nem autorização Master por computador.

## Testes

A API é exercitada com perfil EMPRESA real no middleware, sessão normal sem autenticação Master recente, chave de outro agente e cadastros existentes. São verificados sessão expirada/ausente, vínculo de outra empresa, chave inválida, prova de outro agente, dedo não cadastrado, divergência, ficha/hash/template adulterados, validade do desafio e reenvio idempotente.

O navegador usa duas sessões independentes do mesmo login, IPs sintéticos diferentes, um agente bio1 de origem e outro bio2. Ambos assinam fichas de trabalhadores diferentes sem nova senha, sem cadastro de máquina e sem recadastro. A digital divergente não assina. Sair em uma sessão não encerra a outra. A suíte de operações mantém testes de cadastro/recadastro, entregas/devoluções, impressão e imagens. A suíte JPGED mantém verificação da certificação no cofre.

Não há leitor USB físico neste ambiente. Serviços de identidade e leitores dos testes são sintéticos; a interface e a API executadas são as reais do projeto. Nenhuma promessa de capacidade ilimitada ou compatibilidade universal de navegadores é inferida destes testes.
