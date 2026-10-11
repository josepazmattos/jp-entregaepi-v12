# JPGED — documentos certificados com custo por consumo

## Uso no aplicativo

1. Atualize o **JP Biometria** pelo instalador completo em **Biometria**. Esta versão exige Windows e A1 e-CNPJ ou e-CPF com chave de assinatura.
2. Entre novamente na conta. O Master seleciona a empresa; o cliente já acessa sua própria empresa.
3. Abra **Biometria → Certificado digital → Configurar neste computador**. Na janela nativa do Windows, autorize o empregador e escolha o certificado instalado, ou selecione o A1 e informe sua senha **somente nessa janela local**.
4. O serviço verifica posse da chave, assinatura, identificação e-CNPJ/e-CPF, finalidade A1, cadeia confiável, validade e revogação. O cadastro só fica configurado após essa conferência.
5. Gere a ficha com todas as entregas e devoluções. Na aba da ficha, confira o conteúdo e clique **Confirmar movimentações e assinar**. Uma comparação biométrica positiva confirma o conteúdo completo.
6. A certificação acontece automaticamente. Se houver falha, a biometria permanece salva: use **Certificar documento** para tentar novamente. Uma ficha só aparece como **Documento certificado** após verificação criptográfica e armazenamento.
7. Em **JPGED · Documentos**, baixe o **PDF original**. Use esse arquivo para o Drive, envio e validação. Imprimir novamente em PDF produz outra representação e não preserva a assinatura incorporada.

Cada computador/usuário do Windows que assina precisa de configuração local. Ao trocar o certificado, configure os demais computadores novamente. Desvincular no site impede novas certificações, mas preserva os documentos e o certificado do Windows.

Registros biométricos anteriores à versão 12.10.0 não possuem o hash do conteúdo e não são convertidos retroativamente em documentos certificados. Permanecem disponíveis pelo fluxo anterior, sem alterar seu histórico.

## Pessoa física, jurídica e CAEPF

- e-CNPJ: o CNPJ do certificado deve coincidir com a empresa selecionada.
- e-CPF: identifica o CPF do assinante, extraído do certificado. Não há cadastro de representante, aprovação pelo Master nem consulta de responsáveis ou procurações. A configuração é feita localmente pela própria empresa.
- A verificação é criptográfica: demonstra a identidade indicada no certificado e a integridade do documento. Não comprova, por si só, poderes de representação. O sistema não afirma que os consultou ou validou.
- CAEPF possui tipo próprio no cadastro e na ficha, com 14 dígitos. A validação de formato não consulta a situação cadastral na Receita; o Master confere o comprovante. A chave interna `cnpj` permanece por compatibilidade, acompanhada de `inscricaoTipo: CAEPF`. Cadastros existentes continuam CNPJ, sem migração de identidade. O cadastro manual de trabalhadores funciona; a importação SOC atual continua exigindo CNPJ.
- A configuração local assina uma autorização restrita às fichas do empregador selecionado; o original CMS fica preservado em evidências privadas.
- CPF é lido do atributo ICP-Brasil otherName 2.16.76.1.3.1 (posições 9–19) ou serialNumber 2.5.4.5. Identificadores conflitantes são recusados. Não se extrai CPF por aproximação do nome do certificado.
- MEI e ME não são tipos de certificado. O uso de e-CPF depende da identidade e dos poderes do titular para aquele empregador.

## Formas de uso do A1

| Forma | Atendimento nesta versão |
|---|---|
| Arquivo PKCS#12 `.pfx` / `.p12` | Importação pela janela local; senha fora do site |
| A1 instalado para o usuário Windows | Seleção pelo repositório CurrentUser/My |
| A1 instalado para o computador Windows | Leitura de LocalMachine/My; exige permissão de uso da chave já concedida ao usuário. O aplicativo não altera permissões da chave |
| A1 disponibilizado por conector CSP/KSP de nuvem | Usa a interface de assinatura do Windows se o fornecedor a disponibilizar. Compatibilidade depende do fornecedor e precisa ser homologada com ele; não há teste real de serviço de nuvem nesta entrega |
| Certificado oferecido somente por API/web/celular | Exige integração específica com fornecedor, autenticação e documentação da API. Ainda não implementado |
| Cópia `.pfx` guardada em Drive/OneDrive | É um arquivo A1: baixar/importar localmente. Armazenar uma cópia na nuvem não é assinatura remota |
| Arquivo público `.cer` / `.crt` / `.p7b` sem chave | Não permite assinar sozinho |

O filtro criptográfico continua A1. Um serviço comercial de nuvem pode oferecer A3: o local onde está hospedado não altera o tipo do certificado. PIN, MFA e consentimento exigidos pelo provedor são preservados, sem promessa de uso silencioso universal. A autenticação do aplicativo e a única confirmação biométrica da ficha continuam iguais.

## Testes sem expor um certificado real

Não envie PFX/P12 e senha por chat, e-mail ou repositório. Certificados sintéticos e suas chaves são gerados temporariamente nos testes, nunca aceitos pela confiança de produção. Um `.cer`/`.crt` público pode ser analisado, mas não testa a posse da chave privada nem substitui o teste local.

A cobertura inclui e-CNPJ/e-CPF, CPF legado e serialNumber, cadeia com intermediária, assinatura adulterada, e-CNPJ divergente, certificado vencido, LCR revogada/expirada/indisponível, troca durante a operação, repetição e isolamento entre clientes. O Windows executa os caminhos reais de importação e assinatura com A1 sintético, incluindo senha incorreta e chave ausente. Testes de interface usam agente simulado. Não garantem antecipar todos os problemas de antivírus, leitor USB, permissões ou de uma instalação específica.

Homologação final: no Windows do cliente, configurar localmente um A1 autorizado; usar uma ficha de teste identificada; confirmar a digital uma vez; certificar; baixar o original JPGED; conferir no VALIDAR/ITI; repetir após falha de rede sem outra digital. Não certifique movimentações fictícias como entregas reais. Esta homologação e a leitura física ainda dependem do ambiente do cliente.

## O que fica onde

| Componente | Local | Motivo |
|---|---|---|
| Código e versões do aplicativo | GitHub | Versionamento e publicação; sem fichas, digitais ou certificados privados |
| PDFs originais e evidências | S3 privado em São Paulo | Arquivos separados do banco, acesso temporário autenticado |
| Cadastro do documento, metadados públicos do certificado e auditoria | DynamoDB JPGED | Índice pequeno, cobrança por consumo, isolamento por empresa |
| Cópia dos PDFs/evidências | Outro bucket privado | Replicação automática; aplicação sem acesso ao backup |
| Chave privada e senha do certificado | Computador da empresa | A chave importada fica protegida no Windows; em assinatura remota, permanece no fornecedor; a senha não é salva no aplicativo |

O certificado importado não é marcado como exportável. Certificados já instalados mantêm as proteções que receberam na instalação original. A proteção do computador e da conta Windows continua necessária. Não existe garantia de imunidade a invasões.

## Redução de custos

- Não cria servidor EC2, banco relacional, VPN/NAT dedicado ou máquina ligada permanentemente.
- Reutiliza a API Lambda e autenticação existentes.
- PDFs pequenos, uma cópia principal e uma de backup; sem versões editáveis duplicadas.
- Listas públicas de revogação são guardadas por hash e reutilizadas, sem uma cópia grande por ficha.
- Preparações temporárias expiram em sete dias; desafios e tentativas usam TTL.
- Banco por demanda e recuperação contínua de 35 dias; criptografia gerenciada, sem chave KMS dedicada com mensalidade.
- Sem migração automática para classes frias neste volume: taxas de transição, tamanho mínimo e restauração podem custar mais que PDFs pequenos em armazenamento comum.

Preço consultado na API AWS Price List em 10/10/2026: S3 Standard em sa-east-1, primeira faixa, **US$ 0,0405/GB-mês**. Exemplo calculado: 10.000 PDFs de 100 KiB, duas cópias, ocupam 1,9073 GiB e custam aproximadamente **US$ 0,0772/mês apenas para armazenar os PDFs**. Não é o custo total: acrescem operações/replicação, evidências e LCRs, banco/PITR, execução, logs, tráfego e tributos. Valores variam com uso e câmbio. Não depende de franquia gratuita.

GitHub não é usado como banco de documentos dos clientes: os arquivos têm dados pessoais e biométricos, precisam de acesso por empresa, retenção e recuperação próprios. Repositórios têm limites e histórico difícil de remover; não substituem um GED privado.

Referências: https://aws.amazon.com/s3/pricing/ ; https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits

## Segurança e preservação

- A API recebe CMS público, nunca PFX, senha ou PDF arbitrário do navegador.
- O agente só atende origens autorizadas e obtém o conteúdo da API fixa, com a sessão do usuário.
- A confirmação biométrica contém SHA-256 dos campos imutáveis da ficha. O servidor revalida a prova antes de preparar o PDF.
- O PDF é gerado pelo servidor; sua assinatura detached cobre o ByteRange completo. O CMS inclui ESS SigningCertificateV2 e o subfiltro PDF ETSI.CAdES.detached.
- Cadeia ICP-Brasil v5/v12 fixada a certificados públicos obtidos por HTTPS da AC-JUS e comparados aos arquivos do ITI; origens e hashes em backend/src/data/icp-brasil/sources.json.
- LCR válida e assinada é exigida para cada certificado não raiz. Rede indisponível, LCR vencida ou revogação não confirmada deixam pendente. Consultas bloqueiam rede privada, metadata, redirecionamentos e DNS rebinding.
- Objetos usam escrita condicional, versionamento e bloqueio de acesso público. A aplicação não tem permissão de apagar arquivos; sua identidade é explicitamente impedida de acessar o bucket de backup.
- URLs para download expiram em 60 segundos; respostas privadas sem cache. Logs de auditoria registram configuração, certificação e download.
- Não é PAdES de preservação com carimbo do tempo qualificado/LTV. Evidências de validação são preservadas separadamente; a data não substitui um carimbo de autoridade de tempo. O resultado real no VALIDAR/ITI precisa de homologação com certificado autorizado antes de afirmar conformidade integral.
- O e-CNPJ identifica a pessoa jurídica; o e-CPF identifica seu titular; a prova biométrica registra a confirmação do trabalhador. Não são a mesma assinatura nem dispensam conferência de identidade, regras trabalhistas, retenção e LGPD.

## Recuperação e operação

Infraestrutura: stack CloudFormation **JPGED**, tabela JPGED, buckets jpged-documentos-003020057405 e jpged-backup-003020057405. Replicação é assíncrona, não tem promessa de perda zero ou RPO fixo. O backup está na mesma conta/região: protege contra a aplicação, mas não contra comprometimento administrativo integral ou desastre regional. Uma conta/região independente é evolução opcional com custo e gestão adicionais.

Para recuperar um original, um administrador separado da aplicação lê a versão no backup, confere o SHA-256 registrado e recupera em uma nova chave; nunca sobrescreve o original. Restaure o banco por PITR em uma tabela nova, valide o período e os vínculos por empresa antes de mudar o destino da API. Retenha o banco anterior durante a conferência. Não apague fichas por economia sem política formal de retenção.

Em 10/10/2026 foi criado um objeto sintético identificável e confirmada a replicação (COMPLETED na origem, REPLICA no backup, mesmo tamanho/ETag), além da leitura do conteúdo preservado no backup. Isso verifica replicação e recuperação desse objeto, não uma restauração completa do banco. Nenhum arquivo real de cliente foi utilizado nesse teste.


### Correção 12.10.1 — configuração sem leitor

O certificado pode ser configurado com o Hamster DX desconectado. O instalador completo conclui a instalação do agente e do assinador e informa separadamente que falta conectar o leitor para capturar digitais. Uma instalação antiga em outra porta não deve impedir a busca pelo assinador atualizado. Instale o pacote 12.10.1 para receber também a correção da leitura das respostas da API pelo agente Java.

No Dashboard, **Certificado digital** apresenta a situação do cadastro da empresa selecionada: Pendente, Configurado, Vencido ou Indisponível. Ao clicar, abre Biometria. “Configurado” indica um certificado cadastrado dentro da validade; o acesso à chave local e a validação criptográfica são conferidos novamente a cada assinatura. A ausência do leitor mantém o indicador de Biometria em atenção, sem bloquear o cadastro do certificado.

## Cofre administrado pelo Master — 12.10.1

O Master seleciona a empresa em Biometria e cadastra uma vez um A1 RSA (.pfx/.p12,
2048/3072/4096 bits). A senha do Master é reconfirmada pela interface; a API exige
MASTER e autenticação recente. O PFX é aberto somente no agente do administrador,
sem importação no repositório do Windows. Senha e chave em claro não atravessam a API.
O agente comprova posse, recebe a chave pública de wrapping do KMS e aplica
RSA_AES_KEY_WRAP_SHA_256 (RSA-OAEP SHA256 + AES-256 RFC5649). Somente o material
protegido é recebido pelo backend. A identidade/cadeia/validade/LCR do A1 continuam
verificadas; e-CPF não exige cadastro nem pesquisa de representante.

A chave importada recebe política própria, restrita às operações JPGED do serviço.
A permissão IAM de criação permite somente RSA EXTERNAL SIGN_VERIFY na região da
aplicação; não concede uso geral, alteração de políticas ou marcação de chaves
existentes. O bypass do teste de auto-administração na criação é intencional:
o aplicativo não pode modificar a política; a conta AWS conserva a administração.
Uma invasão do backend/conta administrativa continua sendo risco: KMS protege a
custódia, mas não substitui a proteção do código, da autenticação e das permissões.

A API não oferece assinatura genérica. O job é vinculado ao usuário, empresa,
ficha, prova biométrica, hash do PDF, certificado e prazo. A certificação gera CMS
com atributos assinados e ESS SigningCertificateV2 e valida o resultado antes de
incorporá-lo ao PDF e arquivá-lo. O cliente não recebe ARN/chave privada/arquivo A1.
Certificados antigos locais continuam utilizáveis até migração pelo Master.

Na substituição, a nova chave só é ativada após teste de assinatura; concorrência
usa versões condicionais. Cancelamentos e falhas retiram a chave nova sem alterar
o certificado anterior. Chaves substituídas/desativadas entram em exclusão agendada
em sete dias; os PDFs e os certificados públicos não dependem dessas chaves para
verificação. A desativação no aplicativo não revoga o A1 junto à certificadora.
Operações interrompidas antes de receber a resposta AWS devem ser conferidas no
CloudTrail e nos registros IMPORT/AUDIT; a próxima configuração limpa importação
expirada conhecida. Não há alegação de teste de intrusão independente.

Custo de referência: US$ 1/chave/mês no KMS, proporcional ao tempo, mais operações,
armazenamento, API e tributos. Não enviar A1, senha, chave ou templates biométricos
para GitHub. Cloud A1 não exportável depende da API do fornecedor, não desta importação.
O protocolo imprimível fica em assets/protocolo-certificado.html.
