# JP EntregaEPI 12.8.2

Aplicação de entrega de equipamentos para empresas clientes. O administrador
**Master** cadastra as empresas e disponibiliza seus acessos. Cada empresa
organiza seus trabalhadores e fichas; o catálogo de equipamentos é compartilhado.
Autenticação em Cognito, API em Lambda e persistência em DynamoDB.

- Aplicação: https://www.jptreinamentos.com.br/EntregaEPI/?v=1282
- Versão e commit publicados: https://www.jptreinamentos.com.br/EntregaEPI/version.json
- [Guia das empresas, importação e equipamentos](docs/V12_8_EMPRESAS_E_IMPORTACAO.md)
- [Leitor NITGEN: reparo, conexão e captura na ficha](docs/V12_8_1_BIOMETRIA.md)
- [Correção 12.8.2: busca do SDK recuperada da V11.9](docs/V12_8_2_SDK_DISCOVERY.md)
- [Guia de implantação](docs/DEPLOY_V12_7_1.md)

## Empresas e acessos

| Perfil | Acesso |
| --- | --- |
| Master | Cadastra empresas e logins, configura logos, acompanha as empresas selecionadas e usa o catálogo comum. |
| Empresa | Acessa seus próprios trabalhadores e fichas, atualiza sua logo e utiliza o catálogo comum. |

O login sugerido é o CNPJ completo; o Master pode escolher outro login no
cadastro. A senha inicial digitada pela empresa corresponde aos oito primeiros
caracteres do CNPJ, sem pontuação e preservando zeros. No CNPJ numérico são os
oito primeiros números. No formato alfanumérico, letras são convertidas para
maiúsculas. No primeiro acesso, a empresa define uma senha definitiva conforme
a política do Cognito. A senha inicial segue o prazo de sete dias do pool atual.
Não há envio automático de e-mail ou SMS: o Master entrega as instruções ao cliente.

O aplicativo permite sessões independentes em vários navegadores, abas e
localidades. Entrar ou sair em uma sessão não encerra as demais. O vínculo da
empresa é atribuído pelo servidor e não pode ser escolhido pelo cliente.

Uma falha parcial no provisionamento mantém o cadastro com **Acesso pendente**.
O botão **Retomar acesso** conclui a mesma solicitação, sem duplicar a empresa
ou redefinir a senha de uma conta existente. Empresas cadastradas nas versões
anteriores podem receber acesso preservando seus IDs, trabalhadores e fichas.

## Logotipo e ficha aprovada

O cadastro permite enviar PNG ou JPG. A interface ajusta a imagem para até
48 KB antes do envio, preservando a proporção e a transparência do PNG.
A logo da empresa aparece nas novas fichas. Fichas anteriores preservam o
retrato dos dados e da logo da época da emissão.

O modelo aprovado mantém nome do trabalhador, função, matrícula eSocial e tipo
da movimentação, seguidos do **Termo de Responsabilidade completo, antes da
relação dos equipamentos**. A impressão continua preparada para fichas com uma
ou várias páginas. Uma imagem recebida de um leitor não é apresentada como
biometria verificada.

## Trabalhadores por Excel

Em **Trabalhadores**, baixe o modelo, preencha a aba `Trabalhadores` e envie o
arquivo `.xlsx`, com até **500 trabalhadores e 512 KB**. São obrigatórios nome
completo, CPF, matrícula eSocial, função e localidade. A matrícula eSocial é
um campo textual livre: aceita letras e números, preserva zeros à esquerda e
não possui limite de negócio para a quantidade de caracteres. Essa regra vale
para o cadastro manual e para a importação. No Excel, mantenha a coluna como
**Texto**, para que valores como `0001A000045B` sejam preservados integralmente.

O envio gera uma prévia com inclusões, atualizações e erros. O botão
**Sincronizar trabalhadores** aplica a prévia conferida. CPF e matrícula precisam
identificar o mesmo cadastro; conflitos e duplicidades impedem a confirmação da
planilha. Campos opcionais vazios preservam os valores já cadastrados.
Trabalhadores ausentes da planilha não são excluídos.

A sincronização ocorre em lotes de até 80 registros, com indicação de progresso
e retomada. A prévia dura 30 minutos. Se alguém alterar os cadastros durante o
processamento, os lotes concluídos são preservados e uma nova prévia será
necessária para os restantes. A relação e a seleção para entrega são ordenadas
alfabeticamente, com busca por nome, CPF ou matrícula.

## Catálogo comum e equipamentos sem CA

Os equipamentos cadastrados ficam disponíveis ao Master e às empresas. A
resposta compartilhada apresenta os dados do equipamento, sem indicar qual
empresa o cadastrou nem divulgar observações privadas do cadastro anterior.
Trabalhadores, entregas, assinaturas e fichas continuam separados por empresa.

Para EPI com CA, informe o número e confira os dados da consulta. Modelo e
tamanho distinguem variantes do mesmo CA. Cadastros repetidos reutilizam o item
existente. Para equipamento sem CA, selecione **Equipamento sem CA** e preencha
a descrição; fabricante, modelo e tamanho ajudam a identificá-lo. A ficha
mostra **Sem CA**, sem inventar número ou validade.

## Consulta CAEPI e interface

A consulta usa uma cópia datada da base pública oficial do Ministério do Trabalho
e Emprego. Endereço, hashes e data estão em
[data/caepi-source.json](data/caepi-source.json). O preparo confere o ZIP, o
manifesto e todas as partes compactadas antes de instalar a base. A interface
informa origem e data; não afirma consulta ao vivo. Registros ambíguos bloqueiam
o preenchimento automático e exigem conferência na fonte oficial.

A diagramação verde corporativa da V12.7.2, baseada na proposta JP EntregaEPI do
Canva, é mantida. O menu móvel, o cabeçalho com empresa e usuário, os cartões e
os diagnósticos recolhidos continuam disponíveis.

## Testes locais

Use Node.js 22, Python 3, Go 1.27.1 e JDK 17. O componente Java é compilado
para Java 8; o launcher é um executável para Windows de 64 bits. Os testes usam dados sintéticos e o catálogo público
de CAs, sem criar contas ou alterar trabalhadores no ambiente de produção.

```bash
npm ci --prefix backend --no-audit --no-fund
python3 infra/fetch_ca_snapshot.py
npm test --prefix backend
python3 -m unittest discover -s infra -p 'test_*.py' -v
python3 native/biometria/test_native.py
python3 native/biometria/build.py --output native/biometria/dist --build-sha "$(git rev-parse HEAD)"
python3 infra/biometria_release.py --source native/biometria/dist --destination frontend/EntregaEPI/assets --commit "$(git rev-parse HEAD)"
npm ci --prefix tests --no-audit --no-fund
npm --prefix tests run install-browser
npm --prefix tests test
```

O teste de navegador baixa Chromium na primeira execução. Suas imagens, PDFs e
resultados em `tests/output/` contêm somente exemplos sintéticos.

## Publicação

O workflow **Testar e publicar JP EntregaEPI** testa `main`, `v12-teste` e
`install-v12-7-recovery-20261006`. Somente `main` publica, usando exatamente o
commit aprovado pelos testes da execução.

O job de testes compila o reparador de biometria a partir desse commit, confere
versão, arquitetura Windows, tamanho e SHA-256, e guarda o executável e seu
manifesto como artefato. A publicação baixa esse mesmo artefato da mesma execução;
não recompila o instalador nem usa uma URL de versão flutuante. Os dois arquivos
entram no backup, no manifesto público, na verificação por hash e na restauração
automática. Bibliotecas proprietárias NITGEN não são incluídas no repositório.

Antes da publicação, outro job executa esse mesmo instalador em um runner Windows,
com pasta temporária que contém espaços. Confere o protocolo, o registro do
usuário, a inicialização e o reparo da instância autenticada. O runner não tem
leitor NITGEN: esse teste exige o diagnóstico correto de SDK ausente e não
representa captura USB. A publicação depende também da aprovação desse job.

Antes de qualquer alteração, a implantação confere conta, tabela, Lambda, API,
vínculo Cognito imutável, permissões de leitura/escrita do cliente, grupos e TTL.
A configuração administrativa desses pré-requisitos é feita separadamente;
o workflow apenas os consulta. A automação mantém backups, condições contra
sobrescrita concorrente, proteção JWT, verificação pública por hash e recuperação.

A presença do código no repositório não comprova instalação. Confirme o resultado
do workflow e o commit de `version.json`. O instalador manual antigo permanece
desativado.
