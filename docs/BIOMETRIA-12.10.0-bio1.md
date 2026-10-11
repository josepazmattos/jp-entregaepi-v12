# Recuperação da biometria — 12.10.0-bio1

## Alteração

O SDK empacotado não interrompe mais a procura por instalações anteriores do fabricante. O reparador verifica a inicialização em processos separados, considera a arquitetura do Java e só registra um SDK como válido após inicialização bem-sucedida. Erros 15, 24, falhas de carregamento e timeouts não são aceitos como sucesso.

O código de captura, recadastro, comparação, exportação da imagem e prova biométrica é idêntico ao publicado em 12.10.0. Nenhuma biblioteca NITGEN, driver, digital, ficha ou chave biométrica é substituída pelo reparador. A correção de respostas JSON de cert1 é preservada; não há implantação do cofre de certificados.

## Evidências

- Executável: `JP-Biometria-Setup-12.10.0-bio1.exe`, 7.929.856 bytes.
- Commit do executável: `fbb467e4d68419c50a3064be950e5f8888a6886c`.
- SHA-256: `06ebfae6a62bc2184d1bf8f5de24cd93db66f7da910ff92cf00b87a111c7d1ef`.
- CI aprovado: https://github.com/josepazmattos/jp-entregaepi-v12/actions/runs/38104958353
- 83 verificações Java com leitor sintético e testes Go aprovados.
- 27 testes do contrato de integração e 12 verificações de navegador aprovados.
- Windows: instalação e reinstalação do EXE, identidade autenticada, protocolo, preservação da chave, recuperação de SDK em pasta não padrão e limpeza autenticada aprovados.
- Windows com SDK original: duas instalações detectadas e verificadas; ambas retornaram erro 15. O reparador preservou as bibliotecas e não gravou sucesso nem indicou leitor pronto.
- Comparação pela API documentada do SDK original x86 também retornou erro 15. Trocar apenas 64 por 32 bits não demonstrou resolver a falha.

**USB físico não testado neste ambiente.** A imagem NFD fornecida pelo usuário mostra captura funcionando no diagnóstico do driver, mas isso não confirma inicialização bem-sucedida do SDK eNBioBSP.

## Uso no computador

1. Fechar o diagnóstico NITGEN para liberar o leitor.
2. No aplicativo, abrir Biometria e baixar **Reparar biometria**.
3. Executar o arquivo no mesmo usuário Windows que utiliza o aplicativo.
4. Voltar ao site, verificar o leitor e usar **Testar captura**.

Se `NITGEN_15` persistir, nenhuma instalação testada inicializou corretamente. O suporte precisa verificar/restaurar uma instalação válida do SDK do fabricante. Repetir capturas ou instalar o mesmo pacote antigo não resolve essa condição.

Este arquivo é um reparador de componentes existentes, não um instalador inicial de Java/SDK/driver. O download antigo não deve ser apresentado como solução aprovada para o erro 15.

## Publicação

Download versionado: https://www.jptreinamentos.com.br/EntregaEPI/updates/12.10.0-bio1/JP-Biometria-Setup-12.10.0-bio1.exe

O site passa a distinguir o novo reparador do pacote antigo na verificação após download e a explicar o erro 15. O certificado digital fica para a próxima etapa. O executável do CI acima deve ser distribuído sem recompilação; alterações posteriores somente de mensagens/documentação não mudam seu hash.

Antes de uma implantação geral da main ou do cofre, integrar esta correção e reconciliar o pipeline do pacote completo. A PR de recuperação é separada para não promover o SDK que segue falhando nos testes.
