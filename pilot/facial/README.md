# EntregaEPI: piloto facial isolado

Implementação de teste em 30/10/2026. **Ainda não publicada na AWS.**

O usuário autorizou implementar para teste e determinou preservar o NITGEN: uma entrega usa digital OU facial, nunca exige ambos. Nenhum arquivo do backend ou frontend de produção foi alterado. Não houve mudança do agente, driver, porta, cadastro ou verificador de impressão digital.

## O que está implementado

- Página independente, responsiva, com autenticação Master e a verificação MFA já existente. A sessão do piloto é separada da sessão do aplicativo principal.
- Seleção exclusiva do método. Digital abre o procedimento existente; facial usa o componente oficial `FaceLivenessDetectorCore` e credenciais STS temporárias restritas a iniciar a transmissão.
- Cadastro de participante voluntário com conferência de identidade declarada pelo operador, ciência específica e prova de vida. Não há importação de cadastros de trabalhadores de produção.
- Confirmação de uma ficha de teste com itens, quantidades e CA, congelados durante a captura. Comparação 1:1 validada pelo servidor; nenhuma aprovação fornecida pelo navegador é aceita como prova.
- Cadastro, ficha e evidências em PDF; evidências também em JSON. Todos os documentos indicam **TESTE**, sem validade como recibo de entrega e sem assinatura ICP-Brasil. O cofre A1 e o V10 não são utilizados.
- Sessões de uso único, vínculo ao conteúdo, recusa de dados alterados, cancelamento, expiração e isolamento por usuário Master. Operações concorrentes usam condições/transações no DynamoDB.
- Imagens privadas e cifradas, sem vídeo armazenado pelo app; relatórios sem imagens expostas. Exclusão dos próprios dados do teste e indisponibilidade após sete dias. TTL e lifecycle fazem a remoção física posteriormente.

## Limites e condições do piloto

- Máximo de **50 sessões de captura no piloto** e **20 por Master/dia**. Cadastro, novas tentativas e verificação contam como sessões. Os serviços AWS têm cobrança por uso; o limite é de chamadas, não um orçamento em reais.
- Data de encerramento configurada por `PilotEnd`; na implantação, usar sete dias a partir da publicação. O backend bloqueia novas capturas após esse instante.
- Limiares experimentais: prova de vida 98; similaridade 99,5. São parâmetros iniciais de teste, não critérios legais ou taxas comprovadas de precisão. Não utilizar para decisões trabalhistas.
- Usar voluntários adultos e o próprio rosto. O teste não condiciona recebimento de EPI ou emprego. A tela explica luzes coloridas e permite não participar.
- A consulta AWS constatou que a conta não integra AWS Organizations. Não foi possível confirmar política de exclusão de uso do conteúdo para melhoria dos serviços de IA. A condição está explicitada no aviso antes de qualquer captura. Não expandir para empregados em rotina sem resolver governança, contratos, base legal e proteção de dados.
- Não há reconhecimento facial offline. A falta de conexão encerra a captura e não cria confirmação. Usar o navegador atualizado com HTTPS, câmera frontal e celular vertical.
- O cadastro supervisionado registra declaração do operador; não faz consulta automática de documento oficial ou base governamental.

## Verificações executadas

| Verificação | Resultado | Limite |
|---|---|---|
| Serviço facial, autorização e PDF | 27/27 | Provedor e imagens sintéticos |
| Interface no navegador | 12/12 | Chromium 134; câmera e respostas do provedor simuladas |
| Regressão da digital/captura/certificação existentes | 32/32 | Dados sintéticos; sem leitor físico |
| Layout | 6 tamanhos | Emulação, sem aparelho físico |
| CloudFormation cfn-lint | Nenhum apontamento | Validação local |
| CloudFormation Guard | 3 regras aprovadas | Regras explícitas em `infra/security.guard` |
| Dependências npm audit | 0 vulnerabilidades reportadas | Consulta em 30/10/2026 |
| PDFs | Renderizados e conferidos | Cadastro, ficha e evidências com participantes fictícios |
| Pacote Lambda | Inicialização, `/health` e recusa sem token aprovados | Sem chamadas ao provedor |

Não foram testados: rosto real, acurácia, resistência a foto/vídeo/deepfake, SDK com sessão AWS real, iPhone/Android físicos, publicação, IAM efetivo do novo papel e assinatura A1 facial. O teste do navegador inicia também o bundle real sem erros; o fluxo completo usa um substituto do SDK exclusivamente no diretório `test`. Esse substituto não entra no pacote publicado. Não há bypass de aprovação ou modo simulado no backend de implantação.

## Como reproduzir

```sh
cd pilot/facial
npm ci
npm test
npm run build
node test/browser.mjs
python3 infra/build-template.py
python3 infra/package.py
```

O teste de navegador usa o Playwright do runtime indicado em `CODEX_PRIMARY_RUNTIME_NODE_MODULES` e o Chromium instalado no ambiente de desenvolvimento. Artefatos transitórios ficam em `out/` e pacotes em `dist/`, ambos ignorados pelo Git.

Na raiz do repositório:

```sh
node --test backend/test/biometria-login.test.js backend/test/ficha-capture-api.test.js backend/test/jpged-service.test.js
```

## Publicação preparada, pendente de autorização específica

A revisão automática de aprovação rejeitou o upload do ZIP para o bucket compartilhado de implantação, com a justificativa de que a autorização para teste não especificava publicação/upload externo do código. O upload não ocorreu: o objeto retornou 404 em consulta posterior. Não houve tentativa por outro destino ou mecanismo e nenhum recurso do piloto foi criado.

O escopo concreto para autorização é:

1. Enviar somente o pacote Lambda deste piloto ao bucket privado existente `jp-sst-deploy-003020057405-sa-east-1`, sob `facial-pilot/`. O bucket foi conferido com bloqueio de acesso público e criptografia AES256.
2. Criar a stack **jp-entregaepi-facial-pilot** em **sa-east-1**, conta **003020057405**, usando `infra/stack.json`. São 15 recursos novos: API, função, papéis, armazenamento privado, logs e componentes associados. A única leitura de dados da produção é o marcador de MFA do próprio token, com IAM limitado a `MFA#*`. Não há escrita em tabelas, certificados ou fichas de produção.
3. Conferir o change set, as permissões efetivas e a saúde do serviço. Validar que chamadas sem token, sem perfil Master e sem MFA são recusadas.
4. Gerar o frontend com `PILOT_API_URL` apontando para a nova API e publicar somente os arquivos de `dist/web/` em `pagina-conteudo-cloudfront/EntregaEPI/teste-facial/`. Não copiar fontes, testes, resultados ou o ZIP para o site público.
5. Endereço planejado: **https://www.jptreinamentos.com.br/EntregaEPI/teste-facial/index.html**. O `index.html` é explícito porque a distribuição atual usa origem S3 sem reescrita de diretórios nessa rota. Invalidar somente `/EntregaEPI/teste-facial/*` se necessário.
6. Testar acesso real pelo Master e captura voluntária em aparelho físico. A biometria digital permanece intacta.

Não usar `infra/deploy.py` da aplicação principal para este piloto e não mesclar/publicar em `main` como forma de contornar a aprovação pendente.

## Referências técnicas

- https://ui.docs.amplify.aws/react/connected-components/liveness
- https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateFaceLivenessSession.html
- https://docs.aws.amazon.com/rekognition/latest/APIReference/API_GetFaceLivenessSessionResults.html
- https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
- https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html

O piloto não atesta conformidade jurídica de uma operação real. O plano legal e documental anterior permanece em `audit/facial-20261030/`.
