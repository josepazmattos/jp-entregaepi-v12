# Ficha de entrega e impressão eventual do cadastro biométrico

Novas fichas usam o modelo `JP-FICHA-20261030`. A declaração registra o recebimento gratuito dos itens, quantidades e datas; menciona treinamento anterior à entrega de EPI. Certificados de treinamento continuam separados, sem campos ou anexos novos no aplicativo. Devoluções e movimentações mistas têm declarações próprias; uma entrega exclusivamente de itens classificados como não EPI não declara treinamento de EPI.

O texto sobre descontos remete ao art. 462, § 1º, da CLT, exige apuração e afasta desconto automático e desgaste normal. O art. 158 trata da recusa injustificada de uso. A cláusula não transfere as obrigações da empresa na NR-6. Isso não constitui garantia de resultado judicial.

Itens sem CA devem ser classificados na interface como instrumento, uniforme comum, acessório ou outro equipamento não EPI. Somente a classificação explícita imprime “CA não aplicável”. Registros anteriores sem classificação continuam identificados como “Sem CA”. Fabricante, modelo e tamanho disponíveis são preservados no novo registro.

Nenhuma migração de fichas ou PDFs assinados: o texto original, o conteúdo vinculado à biometria e os PDFs certificados existentes permanecem preservados. O servidor rejeita modelos antigos na emissão de novas fichas e pede atualização da página; fichas já emitidas continuam utilizando seus próprios dados e modelo.

## Consulta e impressão opcional

- Trabalhadores → Relatório biométrico: situação atual de todos os trabalhadores da empresa, inclusive inativos, dedos e datas de cadastro, sem imagens.
- Trabalhadores → Digitais → Ficha de cadastro / imprimir: identificação da empresa e trabalhador, imagens disponíveis e datas efetivamente registradas. A conferência da via impressa tem data e assinaturas opcionais, distintas da data do cadastro.
- As prévias abrem sem disparar a impressora. “Imprimir / Salvar PDF” é uma ação explícita. Não é requisito de cadastro, assinatura ou entrega.
- Endpoints somente de leitura, autenticados, com autorização por empresa e `Cache-Control: private, no-store`. Nenhum template, chave pública ou payload de prova biométrica integra a resposta imprimível. As janelas fecham ao mudar de empresa ou sessão.
- São extratos do cadastro atual, não um histórico de recadastros nem documentos assinados digitalmente. A impressão não substitui a assinatura das fichas de entrega ou o certificado de treinamento.

## Validação e publicação

Base: produção `12.10.4-cofre`, commit `22da1d0079b6d9a379fc0917baa076eaca0de745`; não usar a branch principal desatualizada para implantação.

Backend: testes de autorização, isolamento por empresa, texto, integridade, assinatura e layout. Interface: testes unitários e fluxo com API local e leitor sintético; impressão individual, relatório, entrega, devolução, movimentos mistos, recadastro, preservação de históricos e tela móvel. Teste dedicado `tests/biometric-records-browser.cjs`: dez digitais em A4, relatório de 45 pessoas paginado, cadastro vazio e defesa contra HTML/imagens externas. Nenhum trabalhador real nem leitor físico participa desses testes.

Publicação `12.10.5-ficha`: preservar os ZIPs implantados, substituir somente os módulos alterados da API e os dois módulos de renderização do signer (`jpged-pdf.js` e `equipment-classification.js`), com controle de revisão da Lambda. Preservar dependências, base CA, cofre, MFA e chaves. Publicar scripts em diretório imutável de release e aplicar as alterações de HTML sobre as entradas atuais, preservando todos os demais URLs. Manter backups dos pacotes, configuração e entradas anteriores no bucket privado de artefatos.
