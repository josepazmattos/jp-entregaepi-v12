# Impressão compacta e parecer de simultaneidade

## Alteração entregue

Somente `backend/src/services/jpged-pdf.js` altera comportamento de produção. O bloco de autenticação impresso reúne nome do signatário (CN), tipo de certificado, identificador da biometria e SHA-256 do conteúdo em uma caixa compacta abaixo da tabela. O aviso final permanece dentro dessa caixa e não se separa sozinho para outra página. A cadeia textual completa e a repetição do CPF deixam de ocupar a área impressa; a identidade completa permanece na assinatura PDF/CMS. O JSON de evidências, conteúdo confirmado, hash, foto da digital, termo e tabelas são preservados.

Escolha: inscrição resumida, sem QR. Evita criar um link que não autentique o documento ou exponha fichas de trabalhadores fora do acesso da empresa. Os dados técnicos completos continuam no PDF original e no JPGED.

O modelo de referência com logo, termo integral, dois movimentos (entrega/devolução) e biometria passa de duas páginas para uma. Muitos itens ou textos extensos ainda geram páginas adicionais legíveis. PDFs já certificados não são regravados nem recertificados automaticamente; a nova apresentação vale para novas certificações.

## Uso em várias máquinas — situação encontrada

| Componente | Resultado | Limites |
| --- | --- | --- |
| Login da empresa | Sessões independentes; não há exclusividade por máquina/IP no código ou configuração Cognito consultada. Sair de uma sessão não encerra a outra. | Testes usam sessões e IPs sintéticos, sem fazer login real em redes geograficamente distintas. |
| Certificado no cofre | Uma configuração por empresa atende solicitações concorrentes; oito fichas foram assinadas em paralelo com o mesmo ator e a mesma chave RSA sintética, validando CMS, cadeia e revogação. | Teste funcional, não teste de carga de produção nem garantia de capacidade ilimitada. |
| Leitor local | Cada navegador acessa seu próprio `127.0.0.1`; cada máquina precisa de agente/leitor e permissão local. | O agente exige que a chave pública da verificação seja a mesma do cadastro. A digital não é portátil entre instalações. |
| Recadastro de digital | Cadastro atual é único por empresa/trabalhador/dedo. | Recadastrar o mesmo dedo em outra instalação substitui o vínculo anterior; não habilita automaticamente as duas máquinas. |
| Confirmações simultâneas | Conflitos são detectados e os registros preservados. | A gravação biométrica usa uma revisão compartilhada por empresa. Dois trabalhadores distintos confirmados no mesmo instante podem gerar `REGISTRO_ALTERADO` em uma tentativa. Reenvio válido concluiu no teste do serviço; o fluxo de tela pode exigir repetir a operação. |

Conclusão: login e cofre permitem simultaneidade, mas o fluxo biométrico atual não deve ser anunciado como uso transparente do mesmo trabalhador em qualquer máquina nem como ausência de conflitos simultâneos. Esse comportamento foi apenas examinado/testado, conforme a orientação de não alterar a biometria que está funcionando.

## Verificação

- 45 testes de backend: impressão de uma página, muitos itens com/sem CA, nome extenso sem cortes, evidências e identidade completa no PDF, assinatura CMS/PDF, isolamento e oito certificações concorrentes.
- 13 verificações no navegador, incluindo dois contextos com o mesmo login, agente local independente, indicador do cofre e logout independente.
- Capturas, cofre, identidades e documentos de teste são sintéticos. Não usa chaves privadas reais nem testa dois leitores USB físicos.
- Revisão visual do A4 renderizado. O PDF de demonstração do CI identifica explicitamente dados sintéticos e ausência de validade.
- Congelamento do agente bio1, SDK/Java, cliente biométrico, rotas de trabalhadores/fichas, autenticação de produção e configuração/cofre.
