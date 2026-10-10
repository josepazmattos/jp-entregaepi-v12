# Instalador completo JP Biometria 12.9.4

Pacote offline para Windows x64 e leitor NITGEN FingKey Hamster DX HFDU06.
Instala o agente JP, Java Temurin 8u504-b01 x64 privado, componentes de execução
eNBioBSP 5.2.0.6 e o driver HamsterMouse/FDU01-04-06 4.3.0.32 fornecidos pelo proprietário.
Não abre o instalador de desenvolvimento do SDK e não inclui nem pede serial.
Isso não altera os termos de licença dos componentes do fabricante.

O usuário executa um EXE e autoriza a elevação do Windows caso seja necessário
instalar o driver. Não escolhe arquitetura, diretórios ou componentes. As etapas
são exibidas numa janela de progresso textual e o resultado em uma caixa simples.
Um driver que já esteja funcionando é preservado. Um SDK detectado com leitor
pronto encerra o processo com sucesso sem instalar novamente o driver.

## Preservação e diagnóstico

- O agente usa seu protocolo autenticado para substituir a versão anterior.
- Uma captura em andamento impede o reparo; não há encerramento forçado.
- Digitais, cadastros, chaves e fichas não são apagados nem enviados ao instalador.
- Cada arquivo do pacote é conferido por SHA-256 antes de executar componentes.
- Bibliotecas de mesma versão e conteúdo são reutilizadas; arquivos divergentes
  não são sobrescritos em uso.
- O Java é privado da JP e não muda JAVA_HOME, PATH ou Java de outros programas.
- Não desativa isolamento de núcleo, antivírus, assinatura de drivers ou políticas.
- Com integridade de memória ativa e sem driver funcional, o driver legado do
  pacote é bloqueado e orienta obter driver compatível com a FingerTech.
- SDK instalado não equivale a leitor pronto. Sucesso exige ok, sdk e reader,
  sem checking ou busy. Uma assinatura real continua exigindo comparação biométrica.
- Sem leitor conectado, a orientação é conectar e executar novamente.

## Build e validação

`build.py` recebe inventário de arquivos fornecidos, ZIP oficial do Temurin,
agente compilado da mesma revisão e caminho de saída. `vendor-lock.json` fixa
os hashes aprovados. Nenhum binário de fornecedor ou serial pertence ao Git.

No GitHub Actions, `build_ci.py` baixa a base de execução fixada por SHA-256,
confere cada componente e substitui o agente pelo executável do commit atual.
O job Windows executa esse EXE, confere o SDK real sem leitor USB e reinstala
para verificar a preservação da chave e a existência de uma única instância.
A publicação exige os jobs Linux e Windows aprovados, verifica novamente os
hashes e confere os bytes publicados. `version.json` identifica o pacote completo.

O botão de download na tela Biometria acompanha a instalação por até 15 minutos
com consultas de estado, sem capturar digitais. Ao voltar ao site, confere a nova
versão e atualiza o Dashboard. O acompanhamento respeita a permissão de rede
local do navegador e termina ao sair da conta. O cliente executa o arquivo baixado;
o site não executa programas nem aceita a autorização de administrador por ele.

Os testes cobrem travessia de diretórios, checksum adulterado, reinstalação,
preservação de arquivos divergentes e critérios de prontidão. A ponte mantém
os testes de cadastro, imagem e comparação. A descoberta inclui o SDK privado
sem necessidade de configurar variáveis de ambiente.

Limite: compilação cruzada e testes sintéticos não equivalem a executar o pacote
no Windows nem a homologar o HFDU06 físico. O driver fornecido é antigo; um
Windows que rejeite sua assinatura requer versão atualizada do fabricante.
Não rotular esta preparação como homologação física ou garantia universal.
