# Atualização EPI — 07/11/2026

Publicada em produção: `6a4b90139c0e032ae237fd6dcdc0a9435582445f`.

- Termo de responsabilidade e confirmação eletrônica justificados no HTML e no PDF. Admissão no formato DD/MM/AAAA.
- Orientação não confirmada não gera a frase de ausência na ficha. Orientação efetivamente registrada continua disponível.
- Quinze fichas modernas sem orientação confirmada identificadas. Duas certificadas receberam nova revisão PAdES em 07/11; os PDFs foram baixados e conferidos sem a frase. Hashes dos originais preservados e revisões conferidos. As demais usam a impressão atualizada.
- Revisões antigas substituídas por `compact-2-orientacao` ocultas na consulta e nos downloads comuns. Solicitações antigas com `versao=original` recebem a revisão atual. Originais imutáveis mantidos no armazenamento privado de auditoria.
- Vale administrativo vinculado ao EPI anteriormente entregue; perda e extravio não geram devolução física. Reposição vinculada sem lançamento automático de desconto. Notificação separada da criação do registro.
- Cadastro de empresa aceita até dez e-mails separados por ponto e vírgula; destinatários lidos no servidor, com cópia ao SAC, remetente SAC e fallback SAC. Nenhum e-mail real foi enviado durante os testes.
- Sem infraestrutura permanente adicional. Permissão SES limitada ao domínio e remetente SAC; manutenção IAM temporária encerrada e removida.

Validação: GitHub Actions run 42419056281 aprovado (backend, frontend unitário e dois fluxos em Chromium); conferência visual do PDF de produção, integridade dos originais e verificação da versão pública. Código implantado preserva os demais arquivos dos pacotes em uso.

## Proposta pendente — empresas e unidades

Reutilizar o cadastro central JP Treinamentos por CNPJ e sua lista `localidades` (identificador, endereço, CEP, cidade, UF). Selecionar a unidade na ficha, com padrão por trabalhador e fotografia dos dados na emissão. Atualizar o cadastro sob demanda, sem consultas extras em cada renderização. Endereços de documentos históricos não devem ser preenchidos retroativamente por suposição. Esta integração não faz parte da publicação acima.
