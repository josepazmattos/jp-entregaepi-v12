# Segurança do EntregaEPI

Atualização de 27/10/2026: MFA obrigatório para Master, assinador isolado, administração separada das chaves KMS e auditoria com alertas. O material dos oito certificados existentes permanece no KMS. Não há promessa de risco zero.

## Limites entre os serviços

| Serviço | Permissões e controles |
| --- | --- |
| API principal | Mantém os cadastros operacionais. Não cria usuários, altera grupos ou redefine senhas no Cognito; essas operações verificam Master+MFA no serviço administrativo. Consulta o JPGED; não grava seus registros nem assina/administra certificados. Encaminha o JWT original aos serviços isolados. |
| auth-security | Completa somente os desafios Cognito EMAIL_OTP e SOFTWARE_TOKEN_MFA e grava a prova SHA-256 do ID token, sub, auth_time e exp. Único gravador dos registros MFA#. |
| signer | Verifica assinatura/issuer/audience/exp do JWT, empresa, papel e MFA do Master. Recebe identificadores de ficha/job/documento, sem aceitar digest/PDF/chave arbitrários. Assina pelo KMS e grava documentos/evidências. Não importa nem administra chaves. |
| vault-admin | Verifica JWT, perfil Master, MFA e autenticação com até dez minutos para operações de certificado. Importa a chave já envelopada no navegador; não recebe PFX nem senha. Possui negação explícita de kms:Sign. Mantém provisionamento e restauração de acesso de empresas com Master+MFA, lendo o login e o vínculo somente do cadastro confirmado. O grupo de provisionamento é fixo em EMPRESA. Mantém a configuração do destino V10 com Master+MFA, sem exigir nova senha para essa configuração. |
| security-alerts | Recebe eventos de segurança e envia resumos ao endereço configurado. Não inclui tokens, códigos MFA, certificados ou dados biométricos. Deduplicação por ID do evento. |

A leitura histórica de certificados e PDFs por Master permanece disponível mesmo para empresa excluída. Novas assinaturas e operações de certificado continuam bloqueadas nesse caso. A separação reduz o alcance de uma falha da API, mas o assinador permanece um componente de confiança e deve receber manutenção e revisão de código.

## MFA

O pool Cognito disponibiliza e-mail e TOTP como OPTIONAL para preservar os acessos de empresas. O requisito Master é imposto no backend, independentemente da interface: a sessão só é aceita se houver prova do desafio concluído para aquele ID token específico. Desabilitar uma opção de interface ou renovar um token sem passar pelo desafio não cria essa prova.

O Master usa senha e código enviado ao e-mail da diretoria. O código expira em dez minutos, pode ser colado na tela e vale somente para a sessão de login que o solicitou. Não é necessário cadastrar aplicativo ou chave TOTP. A interface mantém compatibilidade com usuários que já utilizem TOTP. Alterar/desvincular certificado pede senha e novo código.

O Cognito usa o SES verificado, com envio nativo de MFA. O cliente permite somente autenticação inicial por senha (USER_PASSWORD_AUTH/SRP), sem USER_AUTH/passwordless: EMAIL_OTP deve continuar sendo um segundo fator. O e-mail não pode ser alterado pelo cliente web; sua troca exige administração AWS autorizada. Os demais acessos de empresas conservam seus fluxos. A recuperação de senha continua administrativa no aplicativo; o Cognito não permite recuperar a senha pelo mesmo e-mail usado como MFA.

Se várias pessoas compartilham Master e caixa postal, cada entrada recebe sua própria sessão, mas os registros identificam a conta compartilhada. Atribuição pessoal exige usuários individuais. Perda do e-mail exige recuperação por administrador AWS autorizado, com verificação de identidade, encerramento de sessões, invalidação das provas MFA# afetadas e conferência dos eventos. Não desligar o requisito Master global para recuperar uma conta.

## Auditoria e alertas

A stack `jp-entregaepi-security` mantém CloudTrail multirregional com validação de logs, S3 privado/versionado e criptografia com chave KMS própria da auditoria. As chaves dos certificados não são substituídas por essa chave. Registra eventos de administração e eventos de dados dos objetos JPGED e tabelas JPGED/sessões. CloudWatch mantém logs dos quatro serviços por 90 dias; o histórico persistente fica no S3.

Alertas por EventBridge e SES para `diretoria@jptreinamentos.com.br`:

- dez recusas em cinco minutos, incluindo recusas de MFA da API;
- cem certificações/revisões em cinco minutos;
- erro de execução nos serviços isolados;
- alterações administrativas no KMS da região (inclui chaves de outros sistemas na mesma conta, para não omitir novas chaves);
- alterações/desativação da trilha de auditoria;
- alterações de MFA, perfil e contas no Cognito.

Esses limites iniciais devem ser ajustados ao volume legítimo. Um alerta é um indício a investigar, não comprovação de invasão. O destinatário é restrito por IAM. A infraestrutura tem custos de Lambda, DynamoDB, KMS, CloudTrail/S3, CloudWatch e SES conforme uso.

## Implantação e recuperação

`stack.json` declara os novos recursos. `security.guard` valida controles essenciais. O bucket privado de artefatos guarda o pacote anterior, a configuração e as políticas antes da mudança. Nenhuma chave privada faz parte do repositório.

A versão em produção continha alterações posteriores ao BUILD_SHA do backend. A atualização preserva essas alterações (consultas, navegação, instalador e destino V10); não substitui o ambiente pelo conteúdo de main.

Ordem de implantação:

1. Conferir estado atual e salvar pacote/configuração/políticas; preservar os snapshots CA/relatório existentes no pacote da API.
2. Validar com cfn-lint, cfn-guard e change set; criar serviços/tabela/trilha/alertas e habilitar TOTP OPTIONAL.
3. Testar em Cognito real com usuário temporário sem acesso às empresas, criado e excluído pelo `live-mfa-probe.mjs`. A função e a role temporárias também devem ser removidas. Não executar esse teste rotineiramente em produção sem uma manutenção autorizada.
4. Publicar os arquivos alterados da interface sob um novo prefixo de release. Preservar os URLs dos demais assets e instaladores; atualizar por último as três cópias de entrada: objetos S3 `EntregaEPI`, `EntregaEPI/` e `EntregaEPI/index.html`. Os endereços com e sem barra final usam objetos HTML próprios.
5. Conceder à API a invocação das três funções e a leitura das provas; atualizar seu código/env com SIGNER_FUNCTION, VAULT_ADMIN_FUNCTION, AUTH_SECURITY_FUNCTION, SECURITY_TABLE e MASTER_MFA_REQUIRED=true.
6. Remover a API das políticas KMS e as permissões de criação de chave e de gravação JPGED/S3. Adicionar negações explícitas. Conferir as políticas efetivas, as oito chaves Enabled, a saúde da API e os alertas.

Em falha de implantação, preferir corrigir os componentes isolados. O rollback integral do pacote antigo exige restaurar também suas políticas anteriores, pois o código anterior assinava na API; essa medida reduz a separação de funções e deve ser tratada como exceção temporária e registrada. Não desabilitar MFA automaticamente. Para recuperação da interface, as três cópias anteriores da página de entrada continuam disponíveis no backup e referencia releases imutáveis.

## Validação

- Backend: 234 testes aprovados, incluindo isolamento de empresa, prova MFA, reautenticação, importação e assinatura.
- Frontend: 81 testes unitários aprovados; navegador real cobrindo MFA, código inválido, bloqueio pré-MFA e tela móvel.
- Navegador JPGED: instalação A1 com certificado sintético, senha errada, prova, certificação/retry, isolamento de empresas e permissões visuais aprovados.
- Cognito real: pareamento TOTP, desafio obrigatório, rejeição de código inválido, prova vinculada ao token e recusa por falta de perfil nos serviços isolados; usuário temporário excluído.
- Auditoria: CloudTrail registrando e entregando arquivos. Teste CloudWatch → EventBridge → Lambda → SES concluído com registro `outcome: sent` (aceite pelo SES, não confirmação de leitura do e-mail).

Os testes não assinam documentos reais nem usam certificados privados de clientes. A continuidade operacional deve ser acompanhada após a confirmação por e-mail do Master.

## Registro da publicação anterior (12.10.2-security2)

API e interface publicadas na versão `12.10.2-security2`, com código `93015be954f9edb57ad13b583327cf6941a4bae9` e pacote SHA-256 base64 `5QfVDdj0gvOQWqnU1gioVFUeGfE9LR9/HQHGcTzq5To=`. A interface reutiliza os assets inalterados da release cfc016c. A API respondeu 403 `MFA_REQUIRED` a um evento Master sintético sem prova. A rota pública de desafio encaminhou o pedido e recusou código malformado com 400. As oito chaves permaneceram Enabled/EXTERNAL, sem principal da API em suas políticas. A simulação IAM confirmou assinatura permitida ao signer e negada à API e ao administrador do cofre; gravação JPGED e criação de prova MFA negadas à API.

O usuário Master estava habilitado e ainda não tinha autenticador pareado ao encerrar a implantação. A interface exige esse cadastro. Os oito alertas PutKeyPolicy emitidos durante a mudança correspondem à separação autorizada das permissões das chaves. A confirmação de envio indica aceite pelo SES, não leitura pelo destinatário.

A conferência das permissões removeu também o caminho indireto de administração de contas: a API conserva apenas AdminGetUser para leitura e deixa de possuir AdminCreateUser, AdminAddUserToGroup e AdminSetUserPassword. O serviço administrativo verifica JWT/MFA independentemente, usa somente dados do registro da empresa e não aceita username, grupo ou senha arbitrários.

Na verificação final, as cinco funções estavam Active/Successful com o pacote acima. IAM confirmou AdminGetUser permitido e AdminCreateUser/AdminAddUserToGroup/AdminSetUserPassword explicitamente negados à API. Uma chamada administrativa com JWT inválido retornou 401 SESSAO_INVALIDA. A página pública e a API de saúde exibiram a revisão final, e o CloudTrail permaneceu entregando registros.


## Atualização de acesso por e-mail (12.10.3-email)

Publicada em 27/10/2026 com código `fb678248ae46b67cf4a4dd39a33e3049370737ab`, API Lambda versão 6 e pacote SHA-256 base64 `UGRJSFXdOVw6g+JkamjOTTEVIfhQuwUeguk0Ss6UtWU=`. As cinco funções estão Active/Successful. O Master usa EMAIL_OTP preferencial para o endereço da diretoria; TOTP está desativado nesse usuário. O SES é DEVELOPER com identidade verificada. A duração do desafio é dez minutos. Senha continua obrigatória e o cliente não pode editar o endereço de e-mail.

A configuração anterior do Cognito/API e os três HTMLs foram salvos no bucket privado antes da atualização. Os três endereços de entrada referenciam a nova configuração; os scripts alterados usam a release `14cbe6fb0f0e2c85a70d257eefcfa9cf9a7c57c5`. Os demais assets e instaladores foram preservados. A invalidação CloudFront terminou.

Validação: 234 testes de backend, 81 de frontend, teste de navegador com código inválido, colagem, tela móvel, reautenticação e recusa de sessão sem MFA. O teste Cognito/SES com usuário temporário sem perfil e destino exclusivo do simulador retornou EMAIL_OTP sem emitir token após apenas a senha; o serviço recusou código malformado. O usuário de teste foi excluído. O endereço genérico do simulador retornou limite de tentativas; o teste com rótulo exclusivo passou. A recepção na caixa da diretoria e a conclusão da entrada precisam ser confirmadas pelo usuário, sem compartilhar senha ou código com o agente.

As oito chaves continuam Enabled/EXTERNAL. A simulação IAM mantém kms:Sign permitido ao assinador e explicitamente negado à API e ao administrador do cofre. CloudTrail continua registrando e entregando arquivos. Compartilhar Master limita a atribuição individual das ações; use contas nominativas quando essa identificação for necessária.

## Instalação assíncrona do cofre (12.10.4-cofre)

A comprovação e a conclusão retornam HTTP 202 depois de verificar Master, MFA recente, empresa e autor da tentativa. A API envia a mesma solicitação por Lambda Event; o administrador valida novamente o token e não recebe PFX nem senha. A tela consulta a situação autenticada, recupera a resposta pública de envelopamento e reconhece a ativação pelo registro definitivo do certificado. Uma falha de rede não envia cancelamento automático. O status não retorna importToken, chave privada ou ARN interno.

Cada etapa adquire a versão do registro antes de validar ou importar. Duplicatas reutilizam o resultado ou recebem estado pendente. Cancelamento e novas tentativas são bloqueados durante uma execução; a reserva dura 150 segundos, acima do limite de execução de 120 segundos. A tentativa completa conserva sua autorização original de cinco minutos. Eventos têm idade máxima de 60 segundos e não são repetidos automaticamente após erro de execução. A tela pode reenviar uma vez uma etapa que permaneça sem processamento, sempre com a mesma identificação.

Falhas na consulta de revogação, identidade, cadeia, importação ou correspondência da chave deixam a tentativa com erro consultável. O certificado anterior só é substituído depois de todas as verificações. Após resposta perdida da gravação, uma leitura consistente confirma se a ativação ocorreu antes de qualquer limpeza. Falhas de auditoria ou limpeza posteriores não desfazem o certificado ativado. Mudança de CNPJ ou exclusão da empresa durante a validação é conferida novamente antes de criar a chave ou ativar o cadastro.

Implantação: preservar o ZIP atual e trocar somente os cinco módulos alterados, mantendo snapshots e dependências; atualizar vault-admin antes da API. Ajustar apenas vault-admin para 1024 MB/120 segundos e configurar os eventos assíncronos. IAM, MFA, signer e certificados existentes permanecem sob seus controles atuais. Publicar certificate-install.js, seu Worker inalterado e config.js em release nova; trocar somente esses URLs nas três entradas HTML existentes. Guardar ZIP, configuração e entradas anteriores no bucket privado de segurança antes da publicação.

Validação: 245 testes de backend e 81 testes unitários de interface. O teste `JP_VAULT_ASYNC_TEST=1 node tests/jpged-browser.cjs` usa certificado e cofre sintéticos, atraso de 31 segundos em cada validação, erro 503 após envio da prova e indisponibilidade transitória da consulta. Cobre abertura do PFX no Worker real, senha incorreta, envelopamento/desenvelopamento independente, instalação, acesso Master/empresa e interface móvel. Nenhum certificado privado de cliente faz parte dos testes. A instalação real exige que o Master selecione seu A1 no próprio navegador.
