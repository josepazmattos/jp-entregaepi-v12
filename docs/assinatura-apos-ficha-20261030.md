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

## Publicação e configuração concluídas

Publicação autorizada expressamente e concluída em **30/10/2026**, versão `12.10.6-assinatura`, código `6970314779f61e43ede369acd4345ebed98d388f`. Os três endereços de entrada (`/EntregaEPI`, `/EntregaEPI/` e `/EntregaEPI/index.html`) recebem o mesmo HTML, com os scripts novos em release imutável. Os URLs dos demais componentes foram preservados.

- API `jp-entregaepi-v12-api`: `DhvXXQu+p+RzAgvyzoCWJw5t4DnwtnUK9Qi9CPsjB4c=`.
- Signer `jp-entregaepi-signer`: `DUivfcAnzz569lzioTpZ9L4bvwYQP0gi7jkITQT2XeY=`.
- Stack `jp-entregaepi-facial-signature`: `CREATE_COMPLETE`, região `sa-east-1`.
- Bucket privado: `jp-entregaepi-facial-signature-images-4szcxs3x02ft`, AES256, versionado, bloqueio público e política TLS conferidos.
- Chave facial: `arn:aws:kms:sa-east-1:003020057405:key/e8dc6378-91df-4afa-9c31-108454ee3cca`. Chave pública fixada na API e no signer.
- Organizations `o-ib8ctml5ly`, política `p-90r8yfl5gk` anexada à própria conta. `DescribeEffectivePolicy` confirmou `services.rekognition.opt_out_policy=optOut`. Nenhuma outra conta foi adicionada.

A restrição existente `EntregaEPIDenyDirectCertificateAccess` precisou de uma exceção **somente para `kms:Sign` na chave facial**. `api-certificate-guard.json` registra a política exata aplicada nesta conta. `NotResource` mantém a negação explícita de assinatura em todas as outras chaves; administração de chaves permanece negada inclusive para a chave facial. Não reaplicar a antiga negação global de `kms:Sign` sem essa exceção, pois ela impediria o selo facial. A política de isolamento é externa à stack facial e sua cópia anterior está no backup privado.

Os pacotes publicados e manifesto ficam em `s3://jp-sst-deploy-003020057405-sa-east-1/signature-flow/6970314779f61e43ede369acd4345ebed98d388f/`. Os ZIPs originais e `index.html` estão em `signature-flow/21504c1d4975b3925818597d78f7b67933df22d7/rollback/`; os outros dois HTMLs e a política IAM anterior ficam no diretório `rollback/` da release publicada. Hashes dos ZIPs originais: API `l5uMFirTmdamKcT+uPFh2/lnqeGDBfHJ1DE845YHOUg=`; signer `juL7Sqgr4chBMI7aKUWkf7Dag07mIe9cX6jIFf9Smj0=`.

## Ativação e manutenção pelo Master

1. Entrar no aplicativo como Master, abrir **Biometria → Biometria facial**, conferir “Privacidade AWS verificada”, escolher validade e limites, confirmar custos/responsabilidades e salvar a liberação. Se a autenticação tiver mais de 15 minutos, entrar novamente com o MFA habitual.
2. Renovações, pausas e ajustes posteriores são feitos nesse painel, sem atualização de código ou solicitação nesta conversa. A primeira ativação e seus limites não foram escolhidos automaticamente durante a publicação.
3. A empresa controladora precisa definir aviso, base legal, acesso, responsabilidades e conservação. O aceite da ficha não é consentimento genérico de tratamento. Os recursos de evidência têm `Retain`; não aplicar a expiração curta do piloto a recibos reais.
4. Testar com participação autorizada em celular real: conferir identidade, cadastrar rosto, gerar ficha, assinar facial, certificar A1, baixar original e verificar evidência. O teste real do piloto anterior foi informado como bem-sucedido pelo usuário; o teste real deste fluxo integrado ainda precisa ser executado.

Na recuperação da infraestrutura, preservar as variáveis existentes e restaurar `FACIAL_BUCKET`, `FACIAL_STREAM_ROLE_ARN`, `FACIAL_ATTESTATION_KEY_ARN`, `FACIAL_QUOTA_TABLE`, `FACIAL_ACCOUNT_ID` e `FACIAL_TRUSTED_KEYS` na API, além de `FACIAL_TRUSTED_KEYS` no signer. A disponibilidade depende do banco e da política efetiva. Nunca contornar a consulta de privacidade com um flag manual.

## Validação desta implementação

- 70 testes de backend: ficha/modelo, digital, facial, concorrência, autorização, PDF e certificação.
- 83 testes unitários do frontend.
- 4 verificações de navegador com UI e API reais locais, dois agentes NITGEN simulados e mesmo login em dois contextos Windows emulados.
- 6 verificações do painel Master com serviço de configuração real em memória, sem AWS.
- 9 verificações da nova escolha e captura facial no navegador com provedor sintético, inclusive seis tamanhos, cancelamento e resposta tardia.
- PDFs digital, facial do servidor e impressão do navegador renderizados e conferidos; amostras de dois itens continuam em uma página.
- Template validado com cfn-lint e regras específicas cfn-guard, sem apontamentos. Change set e `DescribeEvents` conferidos antes da execução.
- Bundle real da câmera carregado sem captura automática; bundle do provedor gerado sem substituir dependências do backend existente.
- Site publicado conferido com navegador real em 390, 768 e 1440 px: sem erro JavaScript, falha de recurso ou rolagem horizontal na entrada; painel Master e bundle real facial presentes.
- API pública de saúde retornou 200 com a release nova; rotas de fichas e controle facial recusaram acesso sem autenticação com 401.
- Verificação temporária usando o bundle publicado e o mesmo papel IAM da API confirmou, na AWS real: política de privacidade, leitura da cota, selo KMS conferido com a chave fixada e obtenção das credenciais temporárias do papel de transmissão. Nenhuma captura ou dado de trabalhador foi usado. A função temporária foi excluída após o teste.

Testes automatizados não medem precisão facial, resistência a fraude, leitor físico nem aparelhos físicos. Os limiares 98/99,5 são experimentais, não critérios legais.

Referências: [MP 2.200-2, art. 10, §2º](https://www2.camara.leg.br/legin/fed/medpro/2001/medidaprovisoria-2200-2-24-agosto-2001-391394-normaatualizada-pe.html); [LGPD, arts. 5º, II, 11 e 46](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html); [AWS Face Liveness FAQ](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html); [política de opt-out](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out_syntax.html).
