# Empresas clientes, trabalhadores e catálogo — V12.8.0

## Responsabilidade de cada acesso

O Master administra a oferta do aplicativo às empresas clientes: cadastra a
empresa, define o login, entrega as instruções de acesso e orienta sua equipe.
Cada cliente acessa somente os próprios trabalhadores, movimentações e fichas.
O catálogo descritivo dos equipamentos é comum a todas as empresas.

## Cadastrar uma empresa e entregar seu acesso

1. Entre com o acesso Master e abra **Empresas**.
2. Informe nome da empresa, CNPJ e os dados de contato. O CNPJ aceita o formato
   numérico e o alfanumérico, mantendo seus 14 caracteres e dígitos verificadores.
3. Confira o login sugerido, que corresponde ao CNPJ completo sem pontuação em
   letras minúsculas, ou informe outro login. Logins usam letras sem acento,
   números, ponto, hífen, sublinhado ou `@`.
4. Selecione a logo PNG ou JPG. Aguarde a prévia terminar antes de salvar.
5. Salve e confira a confirmação do acesso. O aplicativo apresenta o login e a
   senha inicial para o Master entregar à empresa. O sistema não envia mensagens
   automaticamente.
6. Oriente a empresa a entrar no aplicativo e definir sua senha definitiva no
   primeiro acesso.

Para CNPJ numérico, a senha inicial digitada é formada pelos **oito primeiros
números**, incluindo zeros à esquerda. Para CNPJ alfanumérico, são os **oito
primeiros caracteres**, com letras maiúsculas. A nova senha deve ter pelo menos
oito caracteres, uma letra maiúscula, uma minúscula e um número. O prazo atual
para utilizar a senha temporária é de sete dias.

Se aparecer **Acesso pendente**, o cadastro foi preservado. Clique em **Retomar
acesso** para concluir. Um login já utilizado por outra conta será recusado;
a conta existente não é reaproveitada nem tem a senha alterada automaticamente.
Contas desabilitadas, substituídas ou com vínculo divergente exigem revisão
administrativa.

### Empresas já cadastradas

Selecione a empresa no cabeçalho. Na área de criação do acesso da empresa,
confira ou complete o CNPJ, informe o login e conclua o cadastro. O aplicativo
mantém o ID da empresa e os vínculos de seus trabalhadores e fichas. Após a
reserva do acesso, CNPJ e login ficam vinculados àquele cadastro.

### Uso simultâneo

A empresa pode usar o mesmo login em diferentes navegadores, abas e localidades.
Cada sessão mantém sua autenticação e sua seleção de empresa separadamente.
Sair em um navegador não desconecta os outros. O acesso Empresa não pode
selecionar outra empresa pelo cabeçalho ou pela API.

## Atualizar a logo

Selecione a empresa e envie PNG ou JPG de até 2 MB na área de logotipo. A
interface reduz a imagem para no máximo 600 × 300 pixels e 48 KB, sem distorcer
a proporção. PNG mantém transparência. Confira a prévia e salve.

O Master pode atualizar a logo de uma empresa selecionada; o cliente pode
atualizar a própria. A versão do cadastro evita sobrescrever uma alteração
feita em outra sessão sem perceber. Se aparecer aviso de alteração concorrente,
atualize a tela e confira a imagem atual antes de tentar novamente.

A logo atualizada é utilizada nas **novas fichas**. As fichas emitidas preservam
os dados e a logo registrados na emissão. O modelo aprovado mantém o Termo de
Responsabilidade completo antes da relação dos equipamentos.

## Preencher e sincronizar trabalhadores pelo Excel

Em **Trabalhadores**, clique em **Baixar modelo Excel**. Preencha a aba
`Trabalhadores`, mantendo os cabeçalhos na primeira linha. O arquivo aceita até
500 trabalhadores e 512 KB; não use arquivos com macros ou senhas.

| Coluna | Preenchimento |
| --- | --- |
| Nome completo | Obrigatório. Nome do trabalhador. |
| CPF | Obrigatório. CPF válido com 11 dígitos; pode conter a pontuação habitual. |
| Matrícula eSocial | Obrigatória. Campo textual livre, com letras e números e sem limite de negócio para a quantidade de caracteres. Preserve zeros à esquerda. |
| Função | Obrigatória. Função utilizada na ficha de EPI. |
| Localidade | Obrigatória. Localidade do trabalhador. |
| Setor | Opcional. |
| Data de admissão | Opcional. Use data reconhecida pelo Excel ou `dd/mm/aaaa`. |
| RG | Opcional. |
| E-mail | Opcional. |
| Telefone | Opcional. |
| Status | Opcional. Para novo cadastro sem status, o padrão é Ativo. |
| Observações | Opcional. Informação interna da empresa. |

A matrícula eSocial aceita letras e números tanto no cadastro manual quanto
na planilha, sem uma quantidade máxima de caracteres definida pela regra do
cadastro. Mantenha a coluna como **Texto** no Excel; não converta a matrícula
em número. Por exemplo, `0001A000045B` deve permanecer exatamente assim, com
as letras e os zeros iniciais.

Envie o arquivo no aplicativo. A **prévia** mostra as linhas a incluir, as que
atualizam um trabalhador existente, as que permanecem iguais e as que precisam
de correção. Revise antes de clicar em **Sincronizar trabalhadores**.

CPF e matrícula precisam apontar para o mesmo trabalhador. CPF repetido,
matrícula repetida ou identificação conflitante impedem a confirmação da
planilha até a correção. A validação não escolhe silenciosamente qual cadastro
sobrescrever. Os campos opcionais deixados vazios preservam valores existentes;
a ausência de uma pessoa na planilha não exclui seu cadastro.

A prévia pode ser confirmada durante 30 minutos. A sincronização processa lotes
de até 80 registros e exibe o progresso. Uma falha de rede permite retomar os
lotes restantes. Se uma alteração concorrente modificar os dados de referência,
o processamento será interrompido; os lotes concluídos serão mantidos. Envie a
planilha novamente para gerar uma prévia baseada no estado atual.

Ao concluir, os trabalhadores aparecem automaticamente em ordem alfabética.
Use a busca por nome, CPF ou matrícula para conferir um cadastro. A seleção de
trabalhadores na entrega também acompanha essa ordenação.

## Cadastrar e reutilizar equipamentos

### EPI com CA

Em **EPIs e CA**, escolha o cadastro com CA, informe o número e consulte os
dados. Confira descrição, fabricante, validade e situação. Complete modelo e
tamanho quando forem necessários para distinguir variantes.

O catálogo compartilha o equipamento entre as empresas. A combinação **CA,
modelo e tamanho** evita cadastrar novamente a mesma variante. Quando já existe,
o aplicativo reutiliza o registro. O catálogo não informa qual empresa o criou
e não expõe suas observações privadas, trabalhadores, entregas ou assinaturas.

A consulta CAEPI utiliza uma cópia datada da fonte oficial. Confira origem,
data e avisos apresentados. Um resultado ambíguo exige conferência antes de
preencher o cadastro. A consulta não altera o conteúdo histórico das fichas.

### Equipamento sem CA

Selecione **Equipamento sem CA** e informe sua descrição. Fabricante, modelo
e tamanho são opcionais e ajudam a identificar o item. Não preencha um número
fictício, zero ou outro CA apenas para permitir o cadastro.

A combinação descrição, fabricante, modelo e tamanho identifica repetições
nessa modalidade. O item aparece no catálogo comum e pode ser selecionado para
registro de entrega. A coluna correspondente na ficha apresenta **Sem CA**;
o aplicativo não inventa certificado ou data de validade.

## Dados e modelos anteriores

Os IDs e registros de empresas, trabalhadores e fichas existentes são mantidos.
Equipamentos das versões anteriores podem compor o catálogo comum sem alterar
os retratos já registrados nas fichas. A mudança da logo ou de um equipamento
não reescreve automaticamente uma ficha histórica.

A ficha preserva nome do trabalhador, função, matrícula eSocial, tipo de
movimentação e o **Termo de Responsabilidade antes dos equipamentos**. O registro
de uma imagem de assinatura continua distinto da verificação biométrica de um
leitor físico.
