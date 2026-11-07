# Localidades no cadastro da empresa

## Organização conferida no JP Treinamentos

- `empresas`: identidade única por CNPJ, razão social e situação.
- `empresa_localidades`: várias localidades/endereço por empresa, com identificador próprio, cidade, endereço, UF, CEP e situação ativa/inativa.
- O cadastro atual reaproveita a empresa pelo CNPJ ao adicionar uma localidade. A edição usa controle de concorrência; remoções são lógicas.
- O treinamento seleciona a empresa e depois a localidade. O Entrega de EPI mantém a mesma organização.

## Alteração no EPI

O Master adiciona várias localidades no formulário de nova empresa, antes de concluir. Em **Empresas > Editar**, consulta, adiciona, edita e inativa localidades. A inativação pode ser desfeita antes de salvar. O perfil EMPRESA não abre nem grava a gestão de localidades; apenas consulta e seleciona unidades na entrega comum e rápida.

As localidades são gravadas na base existente do JP Treinamentos pelo CNPJ derivado no servidor. Não há cópia independente de cadastro nem banco, fila, serviço de IA ou assinatura adicional. Consultas e gravações usam as funções AWS já existentes; continuam sujeitas à cobrança normal por uso. A consulta utiliza cache e ocorre sob demanda, não a cada login ou impressão.

## Contratos e preservação

- `GET /api/empresas/:id/unidades/cadastro`: Master; consulta atualizada para edição.
- `POST /api/empresas/:id/unidades`: Master; lote de alterações com identificadores estáveis e revisão de cada localidade.
- A criação da empresa aceita localidades no mesmo fluxo. Em falha parcial, informa que a empresa foi salva, mantém o formulário e permite retomar sem duplicar localidades ou recriar acesso.
- Gravação interna IAM `epi-unidades-cadastro-v1`, sem rota HTTP pública nova no JP Treinamentos.
- Transação na base central, CNPJ parametrizado, IDs vinculados à empresa e revisão para rejeitar sobrescritas concorrentes.
- Repetição da mesma solicitação é idempotente, inclusive após perda de resposta. Não remove fisicamente localidades nem altera fichas existentes.
- Cache da empresa invalidado antes da gravação remota e atualizado depois; a emissão valida a versão e o vínculo da unidade.
- Fichas anteriores continuam usando o endereço registrado no documento assinado.
- Limite de proteção existente: 200 unidades ativas por CNPJ e por gravação. Dados de empregador CAEPF continuam usando o endereço principal, sem associação incorreta por nome.

## Validação

- GitHub EPI: commit `b35bc658be6322cda913f097ea7960467cd56ef9`, execução `42423222898` aprovada.
- Backend: 290 testes; interface: 83 testes; fluxos de navegador com dados sintéticos.
- Cobertos: autorização Master/EMPRESA, CNPJ derivado no servidor, criação com duas unidades, edição/inativação, repetição sem duplicidade, conflito de edição, preservação do histórico, seleção comum/rápida e PDF.
- JP Treinamentos: commit `1e0c95b0c4b1e44ee1e8ed04b598683a478718bd`, testes de integração e testes existentes aprovados. Publicação pelo workflow oficial de `main`.

## Publicação confirmada

Publicado em 07/11/2026 pelo fluxo oficial do JP Treinamentos (execução `42422942661` concluída com sucesso). API EPI e interface identificadas pelo build `b35bc658be6322cda913f097ea7960467cd56ef9`; pacote API SHA-256 em base64 `EbX1ZLGgPq5bXudvtZ5ggMQb78TYR1nA2jShlHgrTHc=`. O pacote preserva os demais arquivos da versão anterior de produção; somente as rotas de empresa e o serviço de unidades mudaram. Assinador, biometria, cofre e sincronizações mantidos.

A API confirmou armazenamento durável disponível. Consulta real e somente leitura ao cadastro central retornou as cinco localidades da IVR com revisão. Nenhum endereço real foi criado, editado ou inativado para testes. Backup privado antes da publicação em `entregaepi/cadastro-unidades-20261107/b35bc658be6322cda913f097ea7960467cd56ef9/`. Invalidação CloudFront `I3PZ0BV8603WVXWVS1OJB3F2XG`.
