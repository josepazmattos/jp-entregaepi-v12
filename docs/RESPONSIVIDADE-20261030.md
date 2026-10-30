# Adaptação para celulares, tablets e computadores

Versão: 12.10.6-responsivo. Base: 3ccea1847f1fbf912beb55c59a5a146d3c41efce.

## Alterações

- Ficha de entrega, cadastro biométrico e relatório com largura fluida, texto legível, ações que se reorganizam e tabelas com rolagem própria acessível por teclado.
- Metadados e campos em coluna nas telas estreitas. Impressão mantém o formato A4; documentos assinados armazenados não são alterados.
- Diálogos com altura limitada à área visível, controles adequados ao toque, campos sem redução de fonte que provoque zoom no iOS, respeito à preferência de redução de movimento e às áreas reservadas nas bordas.
- Correção da largura mínima da seção Downloads em telas de 320 px. Navegação em retrato/paisagem preserva foco e recolhimento do menu.
- Detecção de suporte à opção `targetAddressSpace` antes de conectar ao componente local. Permanecem CORS, destino loopback, credenciais omitidas, proibição de redirecionamento e permissão do navegador.
- Android, iOS/iPadOS e desktops conhecidos sem Windows recebem orientação sobre a captura NITGEN. Consultas, cadastros e documentos continuam disponíveis. Digital do celular não é usada para simular assinatura no leitor.

## Verificação

Dados exclusivamente sintéticos; nenhuma alteração em cadastros de clientes.

- 112 testes unitários de frontend e integração local.
- 27 verificações de operações com interface real e API em memória: entrega, cadastro biométrico, comparação, assinatura, divergência, isolamento de empresa, documentos e preservação do histórico.
- Auditoria de geometria em 320×740, 360×800, 390×844, 600×960, 768×1024, 820×1180, 1024×768, 1280×800, 1440×1000, 1920×1080 e 844×390, com perfis Master/Empresa e três modelos de documento.
- Navegação por teclado, fechamento por Escape, devolução de foco, alteração de orientação, indicação Android e emulação de toque/iPhone.
- Impressão A4: ficha de entrega em uma página, cadastro com dez digitais em uma página, relatório de 45 trabalhadores paginado. Inspeção visual das prévias estreitas.

Os testes de navegador executados usam Chromium headless 134. Emulação de iPhone/Android verifica apresentação, toque e identificação do dispositivo; não substitui testes em aparelhos físicos. Firefox e WebKit não puderam ser executados de forma utilizável neste ambiente (execução do Firefox e dependências ausentes do WebKit). Safari/iOS, Firefox, Edge e Chrome atuais em dispositivos reais ainda precisam de validação nativa; não há declaração de certificação universal de navegadores.

A captura e a assinatura NITGEN continuam dependendo de Windows, leitor, driver e JP Biometria. A impressão/Salvar PDF depende da função disponibilizada pelo navegador e pelo sistema operacional.

## Reproduzir

Instalar as dependências de `tests/package.json` e um Chromium do Playwright. Executar a partir da raiz:

```sh
node --test tests/frontend.test.cjs tests/biometria.test.cjs
node tests/operations-browser.cjs
node tests/biometric-records-browser.cjs
node tests/responsive-browser.cjs
```

Para reproduzir a seção Downloads exatamente como publicada, `JP_TEST_DOWNLOADS` aponta para um diretório com `downloads-center.js` e `downloads-center.css` da atualização pública `updates/downloads-20261023-2/`. A auditoria desta entrega incluiu esses arquivos. `JP_TEST_CHROMIUM` permite indicar o executável local. `JP_TEST_SINGLE_PROCESS=1` é opção de execução do Chromium no ambiente de testes.

## Publicação

Somente frontend. Comparar cada arquivo anterior com o conteúdo publicado, guardar a entrada anterior para reversão, enviar os sete arquivos alterados para uma pasta imutável da nova revisão e atualizar as três entradas HTML do app preservando referências a MFA, certificado, JPGED e instaladores. Invalidar somente os caminhos de entrada do EntregaEPI. API, assinador, certificados e dados de clientes não são modificados.
