// Cada ficha conserva o texto e a versão confirmados pelo trabalhador.
export const MODELO_LEGADO_ID = "JP-DOCX-11.10.6";
export const TERMO_LEGADO = "Declaro sob minha inteira responsabilidade a guarda e conservação dos equipamentos de proteção individual constantes nesta ficha-controle. Assumo também a responsabilidade de os devolver integralmente ou parcialmente, quando solicitado, ou por ocasião de eventual rescisão de contrato, na data do respectivo aviso de qualquer das partes.\n\nTambém estou ciente que, na eventualidade de danificar ou extraviar o equipamento por ato doloso ou culposo, estarei sujeito ao desconto do valor em meu salário, conforme parágrafo único do art. 158 da CLT. Também me comprometo a utilizá-los de forma correta e de acordo com as instruções de treinamento referentes ao uso correto, guarda conservação e higienização dos EPI, recebidas na presente data, fornecidas por profissional Técnico de Segurança do Trabalho. Também estou ciente que a não utilização dos mesmos em minhas atividades profissionais, é ato faltoso e passível de punições legais e disciplinares de acordo com a Consolidação das leis do Trabalho (CLT) – Capítulo V – Seção I – Art. 158o. c/c Norma Regulamentadora (NR) - NR-1 e NR-6, alínea 6.7, disciplinadas pela Portaria MTb. nº 3.214/78 e artigo 191, itens I e II da CLT e súmula n. 80 do TST.";
export const MODELO_FICHA_ID = "JP-FICHA-20261030";
export const RESPONSABILIDADE = "Comprometo-me a utilizar os EPIs para a finalidade prevista, cumprir as orientações recebidas e comunicar dúvidas, danos, extravio ou condições que os tornem impróprios para uso. Responsabilizo-me pela limpeza, guarda e conservação que me competem, sem afastar as obrigações da empresa previstas na NR-6. A recusa injustificada ao uso dos EPIs poderá caracterizar ato faltoso, conforme o art. 158 da CLT. Eventual desconto por dano dependerá de apuração e do atendimento ao art. 462, § 1º, da CLT; não será automático nem decorrente do desgaste normal.";
export const TREINAMENTO_ANTERIOR = "Declaro que fui treinado e orientado anteriormente à entrega dos EPIs recebidos, quanto ao uso, ajuste, limitações de proteção, limpeza, guarda, conservação e necessidade de substituição.";
export const RECEBIMENTO = "Declaro ter recebido gratuitamente os itens relacionados nesta ficha, nas quantidades e datas de entrega discriminadas.";
export const DEVOLUCAO = "Confirmo a devolução dos itens relacionados nesta ficha, nas quantidades e datas de devolução discriminadas.";
export const MOVIMENTACAO_MISTA = "Confirmo as movimentações discriminadas nesta ficha: recebi gratuitamente os itens indicados como entrega ou troca e devolvi os indicados como devolução, nas respectivas quantidades e datas.";
export function modeloFichaParaItens(itens = []) {
  const tipos = [...new Set(itens.map(item => item.tipoMovimentacao || 'Entrega'))];
  const somenteDevolucao = tipos.length === 1 && tipos[0] === 'Devolução';
  const mista = tipos.includes('Devolução') && !somenteDevolucao;
  const entregaEpi = !itens.length || itens.some(item => item.tipoMovimentacao !== 'Devolução' && !['instrumento','uniforme','acessorio','outro_nao_epi'].includes(item.enquadramento));
  const termoResponsabilidade = somenteDevolucao ? DEVOLUCAO
    : (mista ? MOVIMENTACAO_MISTA : RECEBIMENTO) + (entregaEpi ? ' ' + TREINAMENTO_ANTERIOR + '\n\n' + RESPONSABILIDADE : '');
  const outros = itens.some(item => item.semCA === true || item.tipo === 'sem_ca');
  return { id: MODELO_FICHA_ID, formato: 'A4-retrato',
    titulo: outros ? 'FICHA DE CONTROLE DE EPIs E OUTROS EQUIPAMENTOS' : 'FICHA DE CONTROLE DE EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL',
    termoResponsabilidade };
}
export const MODELO_FICHA_APROVADO = Object.freeze(modeloFichaParaItens());
export const TERMO_APROVADO = MODELO_FICHA_APROVADO.termoResponsabilidade;
