# EntregaEPI 12.9.1

## Digitais em Trabalhadores

O botão Digitais abre cartões por dedo, com a imagem da captura, nome, data e Recadastrar. O desenho segue as cores e os componentes do aplicativo e se adapta ao celular.

Instale o **JP Biometria 12.9.1** em Sistema → Biometria para que os novos cadastros incluam a imagem. Templates antigos continuam válidos para comparação, mas não permitem reconstruir a imagem: nesses casos, o cartão mostra “Imagem não armazenada”. Recadastre o dedo para obter a miniatura. Não são geradas imagens ilustrativas de digitais.

A imagem pertence à mesma captura do template e seu hash é incluído na prova assinada pelo agente local. A API valida essa vinculação. Imagens e templates ficam separados do cadastro geral; a galeria autenticada retorna somente imagem, dedo e data, com isolamento por empresa e sem cache. O cadastro antigo sem imagem permanece compatível.

## Excluir empresa

O Master tem Editar e Excluir na linha da empresa. A exclusão exige confirmar o nome e a versão atual do cadastro. Retira a empresa da lista ativa e bloqueia o acesso à API, inclusive com tokens emitidos anteriormente. O contexto ativo é atualizado e os diálogos da empresa são fechados.

A exclusão é lógica: preserva trabalhadores, templates e fichas já emitidas no banco, com data e autor da exclusão. Os documentos não ficam disponíveis na seleção ativa após excluir; salve antes os PDFs desejados no Drive. Não há exclusão em cascata, movimentação de estoque nem envio automático ao Drive. CNPJ e login permanecem reservados. Nenhuma empresa real foi excluída durante os testes.

## Verificação

- API: galeria restrita por empresa, sem exposição de templates; imagem adulterada rejeitada; legado sem imagem; exclusão restrita ao Master; confirmação e versão; preservação de ficha assinada e bloqueio de sessão existente.
- Navegador com API real local e leitor sintético: galeria, cadastro, assinatura divergente/positiva, impressão, exclusão de empresa e adaptação ao celular.
- Java/Go: protocolo de cadastro com imagem vinculada à prova, usando leitor sintético.
- CI mantém testes, instalação/reparo no Windows e implantação como etapas obrigatórias.

A captura física precisa ser conferida no computador com SDK NITGEN e leitor conectado. Os testes não utilizaram digitais reais.
