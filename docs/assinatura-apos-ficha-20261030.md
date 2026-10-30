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

## Estado de liberação

Integração do aplicativo implementada; **facial de rotina bloqueada por padrão**, enquanto faltarem configuração de privacidade e recursos específicos. O piloto isolado anteriormente publicado permanece separado. O usuário informou que seu teste real funcionou; isso não equivale a teste completo de certificação facial no aplicativo principal ou avaliação de acurácia.

Em 30/10/2026, `DescribeOrganization` confirmou `AWSOrganizationsNotInUseException`. A documentação da AWS informa uso possível dos vídeos/imagens para melhoria do serviço sem opt-out. A política proposta em `pilot/facial/infra/rekognition-opt-out.json` impede esse uso para Rekognition. Criar Organizations é mudança administrativa da conta, fora da simples edição do aplicativo: solicitar autorização específica antes de fazê-la. Não configurar `FACIAL_PRIVACY_READY=true` sem política efetiva verificada e definição operacional do tratamento pelo controlador.

Não há novos recursos AWS faciais em produção nesta etapa. `signature-stack.json` está preparado para bucket privado, chave de evidência, papel de transmissão e política mínima da API. Sem alteração do cofre A1 ou do papel do NITGEN. Os recursos de evidência usam `Retain`; definir conservação e descarte de acordo com a finalidade e obrigações aplicáveis, sem aplicar a expiração curta do piloto a recibos reais.

## Próxima ativação após autorização

1. Criar AWS Organizations com todos os recursos, se a conta continuar fora de organização. Não convidar contas nem configurar restrições SCP. Habilitar apenas o tipo `AISERVICES_OPT_OUT_POLICY`, criar a política fornecida e anexá-la à conta 003020057405. Conferir `DescribeEffectivePolicy` com `services.rekognition.opt_out_policy=optOut` antes de capturar dados novos.
2. Revisar o aviso, base legal, responsabilidades contratuais, acesso e conservação com a empresa controladora. O aceite da ficha não é consentimento genérico para tratamento.
3. Validar e criar change set da stack `jp-entregaepi-facial-signature`, sa-east-1. Examinar alterações e eventos de validação antes de executar.
4. Obter `GetPublicKey` da chave de evidências. Preservando as variáveis existentes, configurar na API `FACIAL_BUCKET`, `FACIAL_STREAM_ROLE_ARN`, `FACIAL_ATTESTATION_KEY_ARN`, `FACIAL_QUOTA_TABLE`, `FACIAL_TRUSTED_KEYS` (mapa ARN→SPKI DER base64), `FACIAL_PILOT_END=2026-11-06T11:32:46Z`. Configurar também `FACIAL_TRUSTED_KEYS` no signer isolado; não conceder a ele permissão de assinatura com a chave facial.
5. Confirmar proteção S3, versionamento, permissões e política efetiva; somente então ativar `FACIAL_PRIVACY_READY=true` e `FACIAL_ENABLED=true`. A cota compartilha os contadores do piloto: 50 sessões totais e 20 por operador/dia, sem reinício. O prazo original também não é prorrogado silenciosamente.
6. Testar uma ficha autorizada em celular real: cadastrar identidade, gerar ficha, assinar facial, certificar A1, baixar PDF original e verificar evidência. Não declarar essa validação real como executada pelos testes sintéticos.

## Validação desta implementação

- 64 testes de backend: ficha/modelo, digital, facial, concorrência, autorização, PDF e certificação.
- 83 testes unitários do frontend.
- 4 verificações de navegador com UI e API reais locais, dois agentes NITGEN simulados e mesmo login em dois contextos Windows emulados.
- 9 verificações da nova escolha e captura facial no navegador com provedor sintético, inclusive seis tamanhos, cancelamento e resposta tardia.
- PDFs digital, facial do servidor e impressão do navegador renderizados e conferidos; amostras de dois itens continuam em uma página.
- Bundle real da câmera carregado sem captura automática; bundle do provedor gerado sem substituir dependências do backend existente.

Testes automatizados não medem precisão facial, resistência a fraude, leitor físico nem aparelhos físicos. Os limiares 98/99,5 são experimentais, não critérios legais.

Referências: [MP 2.200-2, art. 10, §2º](https://www2.camara.leg.br/legin/fed/medpro/2001/medidaprovisoria-2200-2-24-agosto-2001-391394-normaatualizada-pe.html); [LGPD, arts. 5º, II, 11 e 46](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html); [AWS Face Liveness FAQ](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html); [política de opt-out](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out_syntax.html).
