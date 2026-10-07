# Instalação JP EntregaEPI 12.8.0

O procedimento atual está em [DEPLOY_V12_7_1.md](DEPLOY_V12_7_1.md).
O guia mantém seu nome histórico e também se aplica à V12.8.0, com empresas
clientes, importação de trabalhadores e catálogo compartilhado. O fluxo de uso
está em [V12_8_EMPRESAS_E_IMPORTACAO.md](V12_8_EMPRESAS_E_IMPORTACAO.md).

A instalação usa o workflow **Testar e publicar JP EntregaEPI**, no repositório
`josepazmattos/jp-entregaepi-v12`. Somente a branch `main` publica, após passar
pelos testes. As branches `v12-teste` e `install-v12-7-recovery-20261006` executam
os testes sem atualizar a aplicação.

O script manual antigo foi desativado. Não execute instruções antigas que
recriam a tabela, substituem variáveis da Lambda ou publicam sem testar.

Aplicação: https://www.jptreinamentos.com.br/EntregaEPI/

Evidência da versão publicada: https://www.jptreinamentos.com.br/EntregaEPI/version.json

Preparar este pacote ou abrir um workflow não comprova a instalação. A confirmação
depende de execução bem-sucedida, commit correspondente e verificações públicas.
