#!/usr/bin/env bash
set -euo pipefail
cat <<'INSTRUCOES'
JP EntregaEPI 12.8.1

A instalação é feita pelo workflow "Testar e publicar JP EntregaEPI" no GitHub.

1. Envie a alteração para uma branch de revisão e aguarde os testes.
2. Após revisar o resultado, promova o commit aprovado para main.
3. O workflow testa o commit da main e publica na AWS.
4. Confira o resultado do job e /EntregaEPI/version.json.

Para repetir a implantação de main, use Actions > Testar e publicar
JP EntregaEPI > Run workflow > main. Não há parâmetros de ambiente.

Guia completo: docs/DEPLOY_V12_7_1.md

Este arquivo não modifica a AWS. O instalador manual antigo foi desativado.
INSTRUCOES
exit 2
