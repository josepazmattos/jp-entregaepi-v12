# Certificado Digital em Sistema — 11/10/2026

## Escopo

Base: biometria funcionando no commit b7b89cacebc9bb3cd7ee327f80dfcba77832946f, agente 12.10.0-bio1. Esta alteração não compila, instala ou publica agente, driver, SDK ou ponte Java. `native/`, `biometria.js`, `operations.js` e as rotas de trabalhadores/fichas permanecem idênticos. O cartão do certificado foi retirado da tela do leitor e ganhou uma tela própria em Sistema.

## Uso

1. Entrar como Master, selecionar a empresa e abrir Sistema → Certificado Digital.
2. Instalar ou substituir A1 → confirmar senha Master.
3. Escolher o .pfx/.p12 e informar a senha do arquivo.
4. Conferir empresa, titular e validade → Instalar no cofre.
5. Aguardar Protegido no cofre. O cliente consulta a situação e usa a certificação das fichas, sem controles de manutenção ou download da chave.

O protocolo para entregar ao cliente está em `frontend/EntregaEPI/assets/protocolo-certificado.html`. A1 em nuvem sem exportação não é importado por este fluxo; depende de integração do fornecedor. Nenhum certificado real foi recebido ou instalado durante o desenvolvimento.

## Correção do empregador

A comparação anterior usava JSON.stringify em mapas provenientes do DynamoDB. Esse armazenamento não garante a ordem das propriedades. Isso gerava falso erro de empregador alterado e também modificava os bytes reconstruídos da autorização assinada. Agora os três campos de identidade são comparados por valor e serializados em ordem fixa na autorização local e do cofre. Mudanças reais de inscrição/empresa continuam bloqueadas.

## Proteção

- Leitura do PFX e senha em Worker isolado e temporário, com limite de 1 MB, profundidade ASN.1 limitada e timeout; encerrado após uso/cancelamento. Não persiste arquivo, senha ou chave em storage do navegador. Sobras gerenciadas de memória JavaScript não têm garantia de apagamento físico; o Worker é terminado.
- RSA 2048/3072/4096; prova por WebCrypto RSASSA-PKCS1-v1_5 SHA-256; chave cifrada via RSA-OAEP SHA-256 + AES-KWP RFC5649, no formato de importação KMS RSA_AES_KEY_WRAP_SHA_256. Apenas cadeia pública, prova e material cifrado passam pela API.
- Validação de cadeia ICP-Brasil, validade, tipo A1, uso e revogação no servidor. Não pesquisa representação da empresa para e-CPF. Uma assinatura real no KMS confirma a chave antes da ativação; o certificado anterior permanece até o sucesso.
- API exige Master e autenticação recente para alterações, vinculadas à empresa e ao ator, com expiração, controle de versão e proteção contra repetição. Clientes podem apenas consultar a situação e certificar fichas previamente confirmadas.
- A1 não é oferecido para download pelo app. Cópias já existentes no Windows ou em outros locais não são removidas. O cofre não elimina riscos de conta administrativa ou computador comprometidos.

## Dependências

Build local, sem CDN: node-forge 1.4.0, @noble/ciphers 2.4.0 e esbuild 0.28.2, versões fixadas e lockfile. npm audit reporta GHSA-86w9-cpqp-85rv em verificação RSA do Forge, ainda sem correção publicada. Essa função não é usada neste fluxo: Forge apenas decodifica/abre PKCS#12 e serializa chaves; verificação de assinatura/cadeia ocorre em Node crypto/PKI.js e assinatura em WebCrypto. Não utilizar Forge para validar assinaturas ou confiança de certificados. Acompanhar atualização dessa dependência.

## Evidências reproduzíveis

- `npm test --prefix certificate-import`: e-CNPJ, e-CPF, cadeia intermediária, PFX moderno, 3DES legado, senha vazia/errada, arquivo inválido/grande, ausência de chave, autorização adulterada e outra empresa. A saída cifrada é decifrada independentemente com OpenSSL/Node e comparada ao PKCS8 original sintético.
- `node --test backend/test/jpged-*.test.js`: 34 testes de cadeia, revogação, PDF/CMS, permissões, repetição, isolamento, preservação da biometria e reordenação de mapas DynamoDB.
- `node tests/jpged-browser.cjs`: navegador Chromium com Worker real, API/cofre de teste e certificados sintéticos; prova e cadeia verificadas e chave desembalada independentemente. Senha incorreta não cria chave; nenhum envio de PFX/senha, nenhuma chamada de certificado ao agente nativo; cliente sem botões administrativos, isolamento entre empresas, indicador, falha/repetição de certificação e visual móvel.
- `node tests/frontend-startup-browser.cjs`: 12 verificações de inicialização preservadas, com agente simulado; não exercita hardware.
- Workflow `certificate-system.yml` verifica congelamento da biometria e reproduz testes sem compilar instaladores.

## Publicação

Publicação direcionada: pacote Lambda anterior preservado e alterado somente nos módulos de certificação e dependência KMS; assets de certificado, app.js com navegação/indicador e três aliases HTML. Nenhuma alteração em configuração, código ou download do agente biométrico. Não executar o pipeline antigo de instalador completo para esta entrega. O teste com o A1 real deverá ser concluído pelo Master no próprio navegador, sem compartilhar arquivo ou senha no chat.

## Correção cert2 — cadeia SAFEWEB e administração exclusiva Master

O erro genérico juntava vencimento e ausência de intermediárias. Dois certificados públicos de tentativas recentes foram conferidos em modo somente leitura: ambos estavam dentro da validade, mas os respectivos PFX informavam apenas o titular. Nenhum PFX, senha ou chave privada foi acessado. Ambos passaram na verificação criptográfica da cadeia completa após a correção.

- Intermediárias públicas AC SAFEWEB RFB v5 e AC RFB v4 obtidas do repositório oficial da emissora e conferidas até a raiz ICP-Brasil v5 já confiável. São candidatas à construção da cadeia, nunca novas âncoras de confiança. Fontes e hashes em `backend/src/data/icp-brasil/intermediates/sources.json`.
- Certificados vencidos, ainda não válidos, cadeia incompleta, emissora fora da validade e cadeia inválida têm mensagens distintas. A validação de assinatura, confiança e revogação permanece obrigatória.
- O cofre guarda a cadeia completa validada para as próximas assinaturas PDF, mesmo quando o PFX contém somente o titular.
- Menu e tela Certificado Digital exclusivos do Master; navegação direta bloqueada no perfil empresa. Cliente mantém apenas indicador e diálogo de situação, sem controles de administração. A API mantém bloqueio Master em todas as alterações.
- Testes adicionais: montagem de cadeia ausente, recusa de raiz não confiável/conteúdo alterado, validade da emissora separada da validade do A1, persistência da cadeia completada, confiança das intermediárias oficiais e leitura sem edição no navegador do cliente.

Os testes de instalação e PDF usam certificados sintéticos. O cadastro real continua exigindo nova tentativa do Master no próprio navegador após a publicação. O agente 12.10.0-bio1 e os arquivos de biometria permanecem congelados.
