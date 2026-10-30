# Entrega, ficha e assinatura por um método

## Comportamento

Registrar a movimentação, gerar e conferir a ficha no modelo existente, confirmar o termo e escolher **Biometria Digital** ou **Biometria Facial**. Uma confirmação aprovada encerra a assinatura desta ficha. Não é exigida a segunda modalidade.

O texto de responsabilidade e a declaração de treinamento anterior à entrega permanecem. A cláusula nova fica no snapshot imutável `modeloFicha`, integrante do SHA-256 confirmado. Documentos anteriores não recebem texto retroativo; originais certificados permanecem intactos.

> Após conferir os itens, quantidades, datas e declarações desta ficha, confirmo seu conteúdo e reconheço a captura biométrica realizada por mim, digital ou facial conforme o método registrado, como minha assinatura eletrônica deste documento. Esta confirmação é vinculada exclusivamente a esta ficha e às evidências de autoria e integridade registradas pelo sistema.

A aceitação é exigida antes da criação do desafio em fichas novas. Ela não substitui a prova técnica, a conferência da identidade nem uma base legal de tratamento de biometria. Não é promessa de aceitação judicial automática.

## Digital

Agente, driver, SDK, template, comparação NITGEN e protocolo de captura preservados. O desafio e o registro guardam adicionalmente a versão e o texto aceitos. Modelos anteriores continuam no protocolo existente.

## Facial

Cadastro supervisionado separado da assinatura. Cadastrar o rosto não assina a ficha. Em seguida, o trabalhador precisa conferir a ficha e iniciar outra captura para assinar.

Prova de vida e comparação 1:1 são consultadas pelo servidor. Não se aceita `matched`, pontuação, imagem ou prova fornecida pelo navegador como confirmação. Desafio vinculado a empresa, trabalhador, CPF do cadastro, ficha, hash do conteúdo e versões dos registros. Cancelamento e concorrência usam condições transacionais. Digital e facial concorrentes não substituem uma confirmação aprovada.

Evidência assinada ECDSA P-256 por chave KMS própria; o certificador verifica a chave pública fixada por configuração. Essa chave é um selo do sistema, não um certificado ICP-Brasil do trabalhador. Depois da confirmação, o PDF segue a certificação A1 existente. A ficha mostra método, data/hora e identificador, sem expor a fotografia facial. Imagens de referência e de confirmação ficam no S3 privado, cifrado e versionado; sem vídeo armazenado pelo aplicativo.

O SDK React da câmera é carregado somente ao escolher facial e iniciar. Fechar, cancelar, trocar sessão/empresa ou perder conexão encerra a interface de captura e ignora callbacks tardios. Sem internet não há confirmação facial.

## Controle pelo próprio aplicativo

Em **Biometria → Biometria facial · Liberação pelo Master**, o responsável pode ativar, pausar, renovar a validade e definir capturas restantes e limite diário por operador. A configuração é global para o aplicativo e permanece no banco, com versão, auditoria e proteção contra reenvio. Não exige recompilar, instalar ou publicar outra versão. Ativação e aumento/renovação exigem login Master recente, MFA do aplicativo e confirmação de cobrança e responsabilidades; a pausa pode ser realizada pelo Master com a sessão válida.

O servidor consulta a política efetiva `AISERVICES_OPT_OUT_POLICY` da própria conta AWS antes de liberar capturas e confirmações. Política ausente, opt-in ou falha na consulta bloqueiam novas confirmações faciais. A digital permanece independente. O painel não permite ignorar a verificação de privacidade.

A contagem é cumulativa e não é apagada ao renovar. O valor informado pelo Master é a quantidade **restante** desejada: por exemplo, 7 usadas + 25 liberadas = teto acumulado 32. A reserva verifica atomicamente a versão ativa da configuração, o teto global e o teto diário. Cadastrar rosto e tentar de novo também consomem cota. A primeira configuração não ativa nada automaticamente. O piloto isolado anterior mantém seu prazo e limite; a liberação no aplicativo precisa de ação explícita do Master.

## Estado da publicação e configuração inicial

**Código pronto; atualização pública ainda não publicada.** A revisão automática rejeitou o envio dos arquivos da interface ao bucket público porque a autorização anterior mencionava somente o bucket privado. Nenhum arquivo foi gravado sob a nova release pública. API e signer chegaram a receber o primeiro pacote; foram restaurados imediatamente aos ZIPs originais após a recusa da interface. `GetFunctionConfiguration` confirmou `Successful` e hashes originais:

- API: `l5uMFirTmdamKcT+uPFh2/lnqeGDBfHJ1DE845YHOUg=`.
- Signer: `juL7Sqgr4chBMI7aKUWkf7Dag07mIe9cX6jIFf9Smj0=`.

Os pacotes iniciais e backups foram enviados ao bucket privado autorizado sob `signature-flow/21504c1d4975b3925818597d78f7b67933df22d7/`. O piloto facial isolado continua separado e o usuário informou que o teste real funcionou. Isso não equivale à validação de uma ficha facial certificada no aplicativo principal nem à avaliação de acurácia.

Em 30/10/2026, `DescribeOrganization` confirmou `AWSOrganizationsNotInUseException`. A política proposta em `pilot/facial/infra/rekognition-opt-out.json` impede uso dos conteúdos do Rekognition para melhoria da IA. A configuração inicial de Organizations e a publicação no site precisam ser autorizadas uma única vez. O controle posterior de disponibilidade ficará no painel, sem solicitar liberações nesta conversa.

## Publicação inicial após autorização

1. Criar AWS Organizations com todos os recursos, se a conta continuar fora de organização. Não convidar contas nem configurar restrições SCP. Habilitar o tipo `AISERVICES_OPT_OUT_POLICY`, criar a política fornecida e anexá-la à conta 003020057405. Conferir `DescribeEffectivePolicy` com `services.rekognition.opt_out_policy=optOut`.
2. Criar o change set da stack `jp-entregaepi-facial-signature` em sa-east-1, com `signature-stack.json`; examinar mudanças e eventos de validação antes de executar. Recursos: S3 privado/versionado/cifrado, chave KMS P-256 para evidências, papel de transmissão e política mínima para API. Sem substituir dependências, cofre A1 ou NITGEN. A API só recebe leitura da política Organizations; não pode criar organizações ou mudar políticas.
3. Obter `GetPublicKey` e, preservando todas as variáveis existentes, configurar na API `FACIAL_BUCKET`, `FACIAL_STREAM_ROLE_ARN`, `FACIAL_ATTESTATION_KEY_ARN`, `FACIAL_QUOTA_TABLE`, `FACIAL_ACCOUNT_ID=003020057405` e `FACIAL_TRUSTED_KEYS` (ARN→SPKI DER base64). Configurar também `FACIAL_TRUSTED_KEYS` no signer isolado, sem permissão de assinatura com a chave facial. A disponibilidade vem do banco e da política efetiva, não de um flag manual de privacidade ou prazo fixado no código.
4. Publicar os pacotes API/signer a partir dos ZIPs atuais conferidos. Publicar os scripts de interface, widget e página de entrada em release imutável no site público; dados biométricos e documentos privados não são publicados. Validar carregamento e rotas sem autenticação. Manter rollback.
5. O Master abre o painel, confere a proteção, define validade/limites e confirma a liberação. A empresa controladora precisa definir aviso, base legal, acesso, responsabilidades e conservação. O aceite da ficha não é consentimento genérico de tratamento. Os recursos de evidência têm `Retain`; não aplicar a expiração curta do piloto a recibos reais.
6. Testar com participação autorizada em celular real: conferir identidade, cadastrar rosto, gerar ficha, assinar facial, certificar A1, baixar original e verificar evidência. Esse teste real do fluxo integrado ainda não foi executado.

## Validação desta implementação

- 70 testes de backend: ficha/modelo, digital, facial, concorrência, autorização, PDF e certificação.
- 83 testes unitários do frontend.
- 4 verificações de navegador com UI e API reais locais, dois agentes NITGEN simulados e mesmo login em dois contextos Windows emulados.
- 6 verificações do painel Master com serviço de configuração real em memória, sem AWS.
- 9 verificações da nova escolha e captura facial no navegador com provedor sintético, inclusive seis tamanhos, cancelamento e resposta tardia.
- PDFs digital, facial do servidor e impressão do navegador renderizados e conferidos; amostras de dois itens continuam em uma página.
- Template da infraestrutura validado com cfn-lint, sem apontamentos.
- Bundle real da câmera carregado sem captura automática; bundle do provedor gerado sem substituir dependências do backend existente.

Testes automatizados não medem precisão facial, resistência a fraude, leitor físico nem aparelhos físicos. Os limiares 98/99,5 são experimentais, não critérios legais.

Referências: [MP 2.200-2, art. 10, §2º](https://www2.camara.leg.br/legin/fed/medpro/2001/medidaprovisoria-2200-2-24-agosto-2001-391394-normaatualizada-pe.html); [LGPD, arts. 5º, II, 11 e 46](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html); [AWS Face Liveness FAQ](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html); [política de opt-out](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out_syntax.html).
