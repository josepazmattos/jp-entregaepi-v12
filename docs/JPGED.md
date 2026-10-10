# JPGED — documentos certificados com custo por consumo

## Uso no aplicativo

1. Atualize o **JP Biometria** pelo instalador completo em **Biometria**. Esta versão exige Windows e e-CNPJ A1 com chave de assinatura.
2. Entre novamente na conta. O Master seleciona a empresa; o cliente já acessa sua própria empresa.
3. Abra **Biometria → Certificado digital → Configurar neste computador**. Na janela nativa do Windows, autorize o CNPJ e escolha o certificado instalado, ou selecione o A1 e informe sua senha **somente nessa janela local**.
4. O serviço verifica posse da chave, assinatura, CNPJ, finalidade A1, cadeia confiável, validade e revogação. O cadastro só fica configurado após essa conferência.
5. Gere a ficha com todas as entregas e devoluções. Na aba da ficha, confira o conteúdo e clique **Confirmar movimentações e assinar**. Uma comparação biométrica positiva confirma o conteúdo completo.
6. A certificação acontece automaticamente. Se houver falha, a biometria permanece salva: use **Certificar documento** para tentar novamente. Uma ficha só aparece como **Documento certificado** após verificação criptográfica e armazenamento.
7. Em **JPGED · Documentos**, baixe o **PDF original**. Use esse arquivo para o Drive, envio e validação. Imprimir novamente em PDF produz outra representação e não preserva a assinatura incorporada.

Cada computador/usuário do Windows que assina precisa de configuração local. Ao trocar o certificado, configure os demais computadores novamente. Desvincular no site impede novas certificações, mas preserva os documentos e o certificado do Windows.

Registros biométricos anteriores à versão 12.10.0 não possuem o hash do conteúdo e não são convertidos retroativamente em documentos certificados. Permanecem disponíveis pelo fluxo anterior, sem alterar seu histórico.

## O que fica onde

| Componente | Local | Motivo |
|---|---|---|
| Código e versões do aplicativo | GitHub | Versionamento e publicação; sem fichas, digitais ou certificados privados |
| PDFs originais e evidências | S3 privado em São Paulo | Arquivos separados do banco, acesso temporário autenticado |
| Cadastro do documento, metadados públicos do certificado e auditoria | DynamoDB JPGED | Índice pequeno, cobrança por consumo, isolamento por empresa |
| Cópia dos PDFs/evidências | Outro bucket privado | Replicação automática; aplicação sem acesso ao backup |
| Chave privada e senha do certificado | Computador da empresa | A chave fica no repositório do usuário Windows; a senha não é salva no aplicativo |

O certificado importado não é marcado como exportável. Certificados já instalados mantêm as proteções que receberam na instalação original. A proteção do computador e da conta Windows continua necessária. Não existe garantia de imunidade a invasões.

## Redução de custos

- Não cria servidor EC2, banco relacional, VPN/NAT dedicado ou máquina ligada permanentemente.
- Reutiliza a API Lambda e autenticação existentes.
- PDFs pequenos, uma cópia principal e uma de backup; sem versões editáveis duplicadas.
- Listas públicas de revogação são guardadas por hash e reutilizadas, sem uma cópia grande por ficha.
- Preparações temporárias expiram em sete dias; desafios e tentativas usam TTL.
- Banco por demanda e recuperação contínua de 35 dias; criptografia gerenciada, sem chave KMS dedicada com mensalidade.
- Sem migração automática para classes frias neste volume: taxas de transição, tamanho mínimo e restauração podem custar mais que PDFs pequenos em armazenamento comum.

Preço consultado na API AWS Price List em 10/10/2026: S3 Standard em sa-east-1, primeira faixa, **US$ 0,0405/GB-mês**. Exemplo calculado: 10.000 PDFs de 100 KiB, duas cópias, ocupam 1,9073 GiB e custam aproximadamente **US$ 0,0772/mês apenas para armazenar os PDFs**. Não é o custo total: acrescem operações/replicação, evidências e LCRs, banco/PITR, execução, logs, tráfego e tributos. Valores variam com uso e câmbio. Não depende de franquia gratuita.

GitHub não é usado como banco de documentos dos clientes: os arquivos têm dados pessoais e biométricos, precisam de acesso por empresa, retenção e recuperação próprios. Repositórios têm limites e histórico difícil de remover; não substituem um GED privado.

Referências: https://aws.amazon.com/s3/pricing/ ; https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits

## Segurança e preservação

- A API recebe CMS público, nunca PFX, senha ou PDF arbitrário do navegador.
- O agente só atende origens autorizadas e obtém o conteúdo da API fixa, com a sessão do usuário.
- A confirmação biométrica contém SHA-256 dos campos imutáveis da ficha. O servidor revalida a prova antes de preparar o PDF.
- O PDF é gerado pelo servidor; sua assinatura detached cobre o ByteRange completo. O CMS inclui ESS SigningCertificateV2 e o subfiltro PDF ETSI.CAdES.detached.
- Cadeia ICP-Brasil v5/v12 fixada a certificados públicos obtidos por HTTPS da AC-JUS e comparados aos arquivos do ITI; origens e hashes em backend/src/data/icp-brasil/sources.json.
- LCR válida e assinada é exigida para cada certificado não raiz. Rede indisponível, LCR vencida ou revogação não confirmada deixam pendente. Consultas bloqueiam rede privada, metadata, redirecionamentos e DNS rebinding.
- Objetos usam escrita condicional, versionamento e bloqueio de acesso público. A aplicação não tem permissão de apagar arquivos; sua identidade é explicitamente impedida de acessar o bucket de backup.
- URLs para download expiram em 60 segundos; respostas privadas sem cache. Logs de auditoria registram configuração, certificação e download.
- Não é PAdES de preservação com carimbo do tempo qualificado/LTV. Evidências de validação são preservadas separadamente; a data não substitui um carimbo de autoridade de tempo. O resultado real no VALIDAR/ITI precisa de homologação com certificado autorizado antes de afirmar conformidade integral.
- O certificado empresarial identifica a empresa; a prova biométrica registra a confirmação do trabalhador. Não são a mesma assinatura nem dispensam conferência de identidade, regras trabalhistas, retenção e LGPD.

## Recuperação e operação

Infraestrutura: stack CloudFormation **JPGED**, tabela JPGED, buckets jpged-documentos-003020057405 e jpged-backup-003020057405. Replicação é assíncrona, não tem promessa de perda zero ou RPO fixo. O backup está na mesma conta/região: protege contra a aplicação, mas não contra comprometimento administrativo integral ou desastre regional. Uma conta/região independente é evolução opcional com custo e gestão adicionais.

Para recuperar um original, um administrador separado da aplicação lê a versão no backup, confere o SHA-256 registrado e recupera em uma nova chave; nunca sobrescreve o original. Restaure o banco por PITR em uma tabela nova, valide o período e os vínculos por empresa antes de mudar o destino da API. Retenha o banco anterior durante a conferência. Não apague fichas por economia sem política formal de retenção.

Em 10/10/2026 foi criado um objeto sintético identificável e confirmada a replicação (COMPLETED na origem, REPLICA no backup, mesmo tamanho/ETag). Isso verifica replicação, não uma restauração completa do banco. Nenhum arquivo real de cliente foi utilizado nesse teste.
