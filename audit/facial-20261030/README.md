# Auditoria de alternativa facial para entrega de EPI em campo

Data: 30/10/2026. Aplicação examinada: EntregaEPI 12.10.6-responsivo, revisão e5d6d6c1ebea90d0890bbe0f30f382ba2937b117.

## Restrição definida pelo usuário

A digital NITGEN existente deve permanecer inalterada. Uma entrega usa **digital OU facial**, nunca exige os dois métodos. O facial deve permitir atendimento em campo pelo navegador do celular/tablet. Este diretório é somente um estudo isolado; não é carregado pela aplicação e não foi publicado.

## Evidências encontradas

- Código atual: `backend/src/services/biometria.service.js` aceita dedos e prova assinada do agente, gravando `NITGEN_VERIFY_MATCH`. O serviço `jpged.service.js` valida prova e imagem de digital antes da certificação. Não foi encontrado fluxo facial, sessão de prova de vida ou SDK de câmera facial no aplicativo.
- AWS consultada em modo de leitura: API ativa em sa-east-1; revisão de frontend publicada compatível com o código examinado. Nenhuma variável de integração facial configurada.
- Nove políticas da função da API foram examinadas; nenhuma concessão de operações Rekognition. Simulação de três operações retornou `implicitDeny` (com contexto DynamoDB ausente, irrelevante à inexistência de concessão Rekognition). Não constitui teste real de chamada facial.
- A documentação atual e as cotas aplicadas da conta confirmam Face Liveness em São Paulo: 5 solicitações/s para Create, Get e Start, e 15 sessões simultâneas. Disponibilidade regional não significa integração pronta.
- AWS exige componente Amplify para a captura/prova de vida; comparação facial é etapa distinta no servidor. Recomendação: comparação 1:1 com cadastro conferido, sem busca indiscriminada por rostos.

## Testes executados

`camera-browser.cjs` usa Chromium 134 e câmera sintética. Dez verificações passaram, incluindo captura sem áudio, quadro em memória, seleção exclusiva de método, parada da câmera, falta/perda de rede, orientação para permissão negada (erro simulado), bloqueio em HTTP inseguro e ausência de envio externo. Seis dimensões de tela foram verificadas. O teste de layout horizontal é apenas da câmera genérica: o componente facial AWS documenta restrição a paisagem em celular.

32 testes existentes passaram em `biometria-login.test.js`, `ficha-capture-api.test.js` e `jpged-service.test.js`, com dados sintéticos. Cobrem a digital atual, expiração, divergência de identidade/conteúdo, isolamento e certificação. Isso não comprova funcionamento de um leitor físico neste ambiente.

**Não testados:** rostos reais, precisão do reconhecimento, resistência real a apresentação de foto/vídeo/deepfake, liveness do fornecedor, latência em campo, navegador Safari/Firefox real, celulares físicos, assinatura/PDF facial ponta a ponta. O aplicativo ainda não dispõe dessa integração.

## Recomendações de implementação futura

1. Criar módulo facial, rotas e permissões próprios; manter agente/SDK/driver e verificador NITGEN intactos. Selecionar um único método no início de cada tentativa e invalidar a tentativa ao mudar método, trabalhador, empresa ou conteúdo.
2. Cadastrar rosto mediante conferência da identidade; versionar cadastros. Não converter impressão digital em rosto nem reutilizar avatar como cadastro confiável sem validação.
3. Apresentar os itens e obter confirmação explícita. Vincular resultado verificado pelo servidor ao hash do conteúdo, empresa, trabalhador, sessão e versão do cadastro. Nunca aceitar score ou status aprovado informado pelo navegador.
4. Preservar resultado e evidências necessárias antes da expiração de três minutos da sessão AWS. A fotografia sozinha, a confiança do detector e o Face ID/passkey do aparelho não equivalem à comparação facial identificada do trabalhador.
5. Manter estado pendente diante de falha, sessão expirada ou ausência de rede. Contingência em papel/manual deve permanecer identificada como tal e com datas reais. Uma falha tecnológica não deve privar o empregado do EPI.
6. Conservar A1/PAdES da empresa como certificação do PDF. Apresentar na ficha o método realmente usado, horário, protocolo e vínculo de integridade. Não afirmar que o certificado da empresa pertence ao trabalhador.
7. Estabelecer base legal, transparência, alternativa para falhas/acessibilidade, retenção, revisão humana, controles de acesso e separação entre empresas. Recomendável elaborar RIPD antes da produção. Confirmar opção de não usar conteúdo para melhoria de serviços de IA e termos de transferência internacional.
8. Piloto assistido em iPhone/Safari, Android/Chrome, tablets e desktops; testar luz, rede, óculos/barba, múltiplos rostos, foto/vídeo apresentado e tentativas reutilizadas. Ajustar limiares com dados representativos, sem confundir score com certeza de identidade.

## Execução local

```sh
NODE_PATH="$CODEX_PRIMARY_RUNTIME_NODE_MODULES" \
JP_TEST_CHROMIUM=/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell \
JP_TEST_SINGLE_PROCESS=1 node audit/facial-20261030/camera-browser.cjs
node --test backend/test/biometria-login.test.js backend/test/ficha-capture-api.test.js backend/test/jpged-service.test.js
```

O JSON de resultados declara explicitamente que não houve reconhecimento facial ou prova de vida reais. Câmera sintética é permitida apenas para testar a interface; não deve ser enviada ao serviço de prova de vida.
