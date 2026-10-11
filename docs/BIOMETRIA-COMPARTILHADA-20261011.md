# Biometria compartilhada entre computadores

Versão do agente: 12.10.0-bio2. Base: impressão compacta e certificado funcionando em e1c164d.

## Funcionamento

O template NITGEN e a imagem de cadastro já ficam no banco do aplicativo, separados por empresa, trabalhador e dedo. Esta atualização remove a dependência exclusiva da identidade do computador de cadastro: o servidor aceita a prova de outro agente previamente autorizado pelo Master para a mesma empresa. O cadastro original não é modificado nem exige nova captura.

Cada tentativa usa um desafio de uso único vinculado ao usuário, trabalhador, dedo, ficha, conteúdo integral e revisão do cadastro. O SDK continua comparando o template cadastrado com a captura local. Dedo sem cadastro, divergência, prova alterada, empresa incorreta ou computador desautorizado impedem concluir a assinatura. A imagem autêntica continua vinculada à prova.

## Instalação uma vez por computador

1. Mantenha a instalação Windows 64 bits, Java, SDK e leitor NITGEN Hamster DX que já funciona.
2. Em Biometria, baixe **Atualizar JP Biometria** e execute. A atualização contém somente o agente JP; mantém o driver, SDK, Java e identidade existente.
3. Entre como Master, selecione a empresa e use **Biometria → Autorizar este computador**. Confirme a senha Master e dê um nome ao computador. Isso não captura digitais.
4. Entre com o login da empresa. As digitais já cadastradas ficam disponíveis. Outro navegador no mesmo usuário Windows usa o mesmo agente, sem repetir essa autorização.

O Master pode desautorizar o computador na mesma tela. Instalação em outro usuário Windows ou reinstalação que apague a identidade exige autorizar a nova identidade. Uma máquina que atende várias empresas precisa ser autorizada separadamente para cada empresa. O agente antigo continua atendendo seu cadastro original; para compartilhar, atualize os computadores.

## Sessões e certificado

Não foi introduzido limite de sessões nem vínculo a IP. O login é independente em cada navegador; sair de uma sessão não encerra as demais. Permanecem as permissões Master/empresa e os vínculos de dados. Cada leitor é exclusivo à captura local enquanto está ocupado. O certificado permanece no cofre da empresa, sem distribuir sua chave aos leitores.

A confirmação agora repete internamente apenas a disputa de revisão geral da empresa quando nenhum registro envolvido mudou. Há até oito tentativas com pequeno intervalo aleatório. Alterações no mesmo trabalhador, ficha ou cadastro biométrico continuam protegidas contra sobreposição.

## Verificação e limites

Testes sintéticos incluem cadastro no agente A e assinatura pelo agente B autorizado, negativa antes da autorização, dedo errado, divergência, prova adulterada, isolamento de empresas, revogação, expiração e reutilização do desafio, autenticação Master recente e compatibilidade antiga. O teste de navegador percorre a autorização Master com senha e a assinatura na aba da ficha. Oito confirmações biométricas de trabalhadores distintos e oito certificações usando o mesmo cofre são executadas simultaneamente.

A verificação nativa preserva os arquivos do SDK, captura e comparação sem alterações. A automação Windows instala/reinstala o EXE publicado e preserva a identidade. Leitores USB físicos e múltiplos IPs reais não são acessíveis neste ambiente. Os testes não demonstram capacidade ilimitada nem compatibilidade com todo navegador; cada máquina precisa do agente/leitor compatível e permissão de acesso local do navegador.

A impressão compacta publicada anteriormente permanece. PDFs já certificados são preservados. Novas fichas curtas cabem em uma página; conteúdo extenso continua paginado sem cortar informações.
