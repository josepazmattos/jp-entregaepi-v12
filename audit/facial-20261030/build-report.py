"""Generate the review report; does not connect to production or process biometrics."""
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = Path(sys.argv[1]).resolve()
OUT.parent.mkdir(parents=True, exist_ok=True)
GREEN = colors.HexColor('#07583D')
INK = colors.HexColor('#172C28')
MUTED = colors.HexColor('#526561')
PALE = colors.HexColor('#EDF5F1')
LINE = colors.HexColor('#D2E0DA')
W, H = A4
CONTENT = W - 34*mm
styles = getSampleStyleSheet()
# Embed fonts so Portuguese text renders consistently across PDF viewers.
pdfmetrics.registerFont(TTFont('Helvetica', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Helvetica-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Courier', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))
styles.add(ParagraphStyle(name='TitleJP', fontName='Helvetica-Bold', fontSize=23, leading=26, textColor=GREEN, spaceAfter=12))
styles.add(ParagraphStyle(name='LeadJP', fontName='Helvetica', fontSize=11.5, leading=15, textColor=INK, spaceAfter=9))
styles.add(ParagraphStyle(name='BodyJP', fontName='Helvetica', fontSize=10, leading=13, textColor=INK, spaceAfter=6))
styles.add(ParagraphStyle(name='SmallJP', fontName='Helvetica', fontSize=9.1, leading=12, textColor=MUTED, spaceAfter=5))
styles.add(ParagraphStyle(name='H2JP', fontName='Helvetica-Bold', fontSize=13, leading=17, textColor=GREEN, spaceBefore=8, spaceAfter=7))
styles.add(ParagraphStyle(name='CellJP', fontName='Helvetica', fontSize=9.5, leading=12.6, textColor=INK))
styles.add(ParagraphStyle(name='CellHeadJP', fontName='Helvetica-Bold', fontSize=9.5, leading=12.5, textColor=colors.white))
styles.add(ParagraphStyle(name='SourceJP', fontName='Helvetica', fontSize=9.2, leading=12.4, textColor=INK, spaceAfter=6))
story = []
def p(text, style='BodyJP'):
    story.append(Paragraph(text, styles[style]))
def h(text):
    p(text, 'H2JP')
def page(kicker, title):
    if story: story.append(PageBreak())
    p(kicker.upper(), 'SmallJP')
    p(title, 'TitleJP')
def table(headers, rows, widths):
    data = [[Paragraph(escape(t), styles['CellHeadJP']) for t in headers]]
    data += [[Paragraph(t, styles['CellJP']) for t in row] for row in rows]
    t = Table(data, colWidths=[CONTENT*w for w in widths], hAlign='LEFT', repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),GREEN),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
        ('VALIGN',(0,0),(-1,-1),'TOP'),
        ('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
        ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
        ('LINEBELOW',(0,0),(-1,0),0.7,GREEN),
        ('LINEBELOW',(0,-1),(-1,-1),0.5,LINE),
    ]))
    story.append(t)
    story.append(Spacer(1,8))

page('Relatório técnico e documental | 30/10/2026', 'Digital ou facial.<br/>Uma opção por entrega.')
p('Alternativa de reconhecimento facial para o EntregaEPI em campo, preservando a leitura digital NITGEN existente.', 'LeadJP')
p('<b>Conclusão:</b> a solução facial é tecnicamente viável em navegador de celular, tablet ou computador com câmera. Ainda precisa ser integrada e validada em dispositivos reais. Esta auditoria não alterou nem publicou código da aplicação e não ativou serviços faciais.')
table(['Opção escolhida', 'Uso proposto'], [
    ('<b>Digital NITGEN</b>', 'Manter o leitor, agente, driver e validação atuais. O reconhecimento facial não será exigido.'),
    ('<b>Facial pela câmera</b>', 'Cadastro facial conferido + prova de vida + comparação 1:1. A digital não será exigida, inclusive no cadastro facial.'),
], [.29,.71])
h('O que existe hoje')
p('A versão examinada foi a 12.10.6-responsivo, revisão <b>e5d6d6c</b>. O código verifica prova assinada do agente NITGEN, trabalhador e conteúdo da ficha. Não foi encontrado fluxo de reconhecimento facial. A função atual da API não tem concessão de operações Rekognition nas nove políticas examinadas.')
p('A documentação AWS e as cotas consultadas da conta confirmam Face Liveness em <b>São Paulo (sa-east-1)</b>: 5 solicitações/s por operação Create, Get e Start, e 15 sessões simultâneas. Isso confirma disponibilidade, não uma integração pronta. [FAQ, SESSAO]')
h('Como usar em campo')
p('<b>1.</b> Conferir a identidade e cadastrar o rosto, com operador autorizado e aviso de privacidade.<br/><b>2.</b> Selecionar trabalhador, itens e método: Digital <b>ou</b> Facial.<br/><b>3.</b> Mostrar a ficha e obter confirmação explícita de recebimento.<br/><b>4.</b> No facial, abrir a câmera frontal e executar prova de vida e comparação com o cadastro selecionado.<br/><b>5.</b> Validar no servidor, vincular ao conteúdo da ficha e certificar o PDF.<br/><b>6.</b> Disponibilizar o comprovante e manter as evidências protegidas.')
p('<b>Condições:</b> HTTPS, permissão de câmera, internet e aparelho compatível. O componente AWS exige celular em posição vertical. Falha de rede mantém a tentativa pendente. Se necessário, usar contingência manual identificada, sem registrar aprovação biométrica inexistente. [REQUISITOS, SDK, CAMERA]', 'SmallJP')

page('Requisitos brasileiros', 'Registro eletrônico<br/>e força da prova')
p('A biometria pode apoiar a identificação e a confirmação do recebimento. A qualidade da prova depende do vínculo com o trabalhador, do conteúdo confirmado e da preservação dos registros.', 'LeadJP')
table(['Referência', 'Consequência para a ficha'], [
    ('<b>NR-6</b><br/>6.5.1(d); 6.5.1.1', 'Admite registro de fornecimento em sistema eletrônico, inclusive biométrico, e exige possibilidade de extração de relatórios. Não impõe reconhecimento facial, impressão digital ou foto impressa.'),
    ('<b>NR-1</b><br/>1.6.2 a 1.6.5', 'Prevê emissão e guarda digital com certificado ICP-Brasil e requisitos de preservação e acesso. Manter a certificação do PDF e sua cadeia de evidências; a captura facial isolada não cobre esses requisitos.'),
    ('<b>MP 2.200-2</b><br/>art. 10', 'Reconhece documentos eletrônicos e admite outros meios de comprovar autoria e integridade nas condições legais. O certificado A1 da empresa identifica seu titular; não se transforma em assinatura qualificada do trabalhador.'),
    ('<b>CPC</b><br/>arts. 369, 411 e 429', 'A prova pode ser apreciada e sua autenticidade contestada. Preservar elementos suficientes para demonstrar autoria e integridade. Não há garantia automática de aceitação judicial.'),
    ('<b>Lei 14.063</b><br/>arts. 2 a 4', 'Não classificar uma selfie como assinatura avançada por si só. O capítulo II tem âmbito próprio e não é fundamento isolado para relações privadas ou processos judiciais.'),
], [.26,.74])
h('LGPD: dados biométricos são sensíveis')
p('Documentar finalidade, necessidade e base legal do art. 11. Prevenção à fraude e segurança da identificação pode ser aplicável, conforme o caso; a obrigação de registrar EPI não torna indispensável usar o rosto. Legítimo interesse não é base para dados sensíveis. Não presumir que o consentimento do empregado resolve todo o tratamento. [LGPD, LEGITIMO]')
p('Definir retenção, acesso, direitos do titular e segurança; evitar guarda indefinida. Recomenda-se RIPD antes da produção. Validar contratos e eventuais transferências internacionais: hospedar em São Paulo não demonstra, sozinho, que todos os fluxos ficam no Brasil. [LGPD, TRANSFERENCIA]')
p('<b>Treinamento:</b> preservar os certificados anteriores à entrega, como já definido. A ficha não deve declarar treinamento realizado no dia do fornecimento quando isso não ocorreu. Os deveres de orientação e capacitação continuam aplicáveis. [NR6, NR1]', 'SmallJP')
p('Análise técnica apoiada nas fontes oficiais consultadas em 30/10/2026. Não certifica conformidade integral da operação nem substitui a avaliação jurídica do caso concreto.', 'SmallJP')

page('Modelo proposto, ainda não implementado', 'Como demonstrar<br/>a verificação na ficha')
p('O bloco abaixo deve ser emitido somente após o servidor confirmar a prova de vida, a comparação facial e o vínculo com a ficha. Usar o método efetivamente escolhido.', 'LeadJP')
table(['Confirmação de recebimento por biometria facial'], [[
    '<b>Trabalhador:</b> [nome e matrícula] &nbsp; <b>Ficha:</b> [número]<br/>'
    '<b>Data e hora:</b> [data/hora da confirmação e fuso]<br/>'
    '<b>Prova de vida:</b> aprovada &nbsp; <b>Comparação facial:</b> aprovada<br/>'
    '<b>Protocolo de evidências:</b> [identificador único]<br/>'
    '<b>Conteúdo confirmado:</b> [hash SHA-256 completo]<br/>'
    '<b>Certificação do PDF:</b> [titular efetivo do certificado A1]<br/>'
    '<b>Consulta das evidências:</b> [endereço/QR com controle de acesso]'
]], [1])
p('<b>Declaração de recebimento sugerida:</b> “Confirmo o recebimento gratuito dos equipamentos e quantidades descritos nesta ficha.” A confirmação deve ser registrada de forma explícita e vinculada à tentativa.', 'BodyJP')
h('Evidências conservadas em registro protegido')
p('<b>Identidade e conteúdo:</b> empresa, trabalhador, versão do cadastro facial, ficha e hash do conteúdo exatamente apresentado; confirmação de recebimento; operador responsável, separado da identidade do trabalhador.')
p('<b>Verificação:</b> fornecedor, identificadores de requisição e sessão, resultado de prova de vida, comparação, scores, limiares usados e versão de configuração. Registrar versões de modelo/desafio quando disponibilizadas pelo fornecedor; não inventar campos que a API não retorna.')
p('<b>Integridade e tempo:</b> horário do servidor em UTC e fuso exibido, evidência autenticada pelo servidor, histórico de alterações e vínculo ao PDF certificado. Guardar os dados de validação do certificado. Hash sozinho não comprova autoria; registros devem ter proteção contra alteração e acesso indevido.')
h('O que evitar')
p('Não imprimir template biométrico ou expor fotos em QR público. Fotografia impressa é opcional e não comprova, sozinha, prova de vida ou concordância. O Face ID/passkey do aparelho autentica uma credencial local e não equivale à comparação do rosto com o cadastro do trabalhador, especialmente em aparelho compartilhado. [WEBAUTHN]')
p('A sessão AWS é de uso único e expira em três minutos. Recuperar e preservar os resultados necessários antes da expiração; guardar apenas o protocolo da sessão não assegura evidência futura. Minimizar imagens e evitar vídeo bruto permanente sem necessidade documentada. [SESSAO, LGPD]')
p('<b>Digital preservada:</b> usar módulo e validador facial próprios. Não substituir o significado de <font face="Courier">NITGEN_VERIFY_MATCH</font> nem apresentar rosto como impressão digital. O certificado da empresa continua distinto da manifestação do trabalhador.', 'SmallJP')

page('Resultados reproduzíveis', 'Testes feitos<br/>e limites da validação')
table(['Verificação', 'Resultado e limite'], [
    ('<b>Backend atual</b><br/>32 de 32 passaram', 'Testes existentes de biometria, captura e certificação, com dados sintéticos. Incluem expiração, divergência de trabalhador/conteúdo e validação de prova. Não houve teste com leitor físico.'),
    ('<b>Protótipo de câmera</b><br/>10 de 10 passaram', 'Chromium 134, câmera sintética e nenhuma pessoa real. Seleção exclusiva de método, encerramento da câmera, captura sem áudio, falhas de rede, bloqueio em HTTP inseguro e ausência de envio externo.'),
    ('<b>Permissão e telas</b>', 'Recusa de câmera simulada apresentou orientação. Prévia e controles couberam em seis tamanhos: 320×740, 390×844, 768×1024, 1024×768, 1440×900 e 844×390.'),
    ('<b>Infraestrutura AWS</b>', 'Consultas somente de leitura confirmaram região, cotas, API ativa e ausência de permissões faciais. Nenhuma sessão facial foi criada. A simulação IAM não substitui chamada real do serviço.'),
], [.30,.70])
p('<b>Não validado neste ambiente:</b> reconhecimento de rostos reais, prova de vida AWS, precisão, resistência a foto/vídeo/deepfake, latência em campo, aparelhos físicos, Safari/Firefox reais e PDF facial de ponta a ponta. O teste horizontal do protótipo genérico não valida o SDK AWS, que restringe paisagem em celular. [SDK]')
h('Melhorias recomendadas após os testes')
p('<b>Antes do piloto:</b> selecionar um método por tentativa; encerrar a câmera ao trocar de método ou sair da tela; invalidar tentativa ao mudar trabalhador, empresa ou itens; usar sessão de uso único vinculada no servidor. Nunca aceitar como prova um “aprovado” ou score enviado pelo navegador.')
p('<b>Usabilidade em campo:</b> orientar luz, distância e posição vertical; informar falhas sem acusar fraude; permitir nova tentativa controlada ou contingência. Sem internet, não marcar entrega como biometricamente confirmada nem retroagir o horário da confirmação.')
p('<b>Antes de produção:</b> cadastrar com conferência de identidade, separar dados de empresas, limitar credenciais temporárias, proteger templates/imagens e definir retenção. Verificar a opção contratual/técnica de exclusão do uso de conteúdo para melhoria de serviços de IA. [FAQ]')
p('<b>Piloto assistido:</b> iPhone/Safari, Android/Chrome, tablets e computador. Medir conclusão, tempo, recusas, revisão manual e falhas de rede; testar diferentes condições de luz e usuários, múltiplos rostos e apresentação de foto/vídeo. Ajustar limiares com evidência: score não é certeza de identidade. Testes antifraude exigem ambiente e participantes autorizados. [COMPARACAO]')
p('A entrega do EPI não deve ser impedida por uma falha tecnológica. Se houver contingência manual, conservar sua natureza e datas reais na regularização posterior. Não converter automaticamente o registro manual em registro facial.', 'SmallJP')

page('Fontes oficiais e encaminhamento', 'Referências<br/>para a implantação')
p('Recomendação: desenvolver um módulo facial separado e realizar piloto assistido. Manter a digital NITGEN sem alterações e adotar apenas um método por entrega. O custo deve considerar verificações, novas tentativas, comparação e armazenamento; não foi contratado nem estimado preço regional nesta auditoria. [PRECO]', 'BodyJP')
p('As referências abaixo são links clicáveis. Consulta em 30/10/2026. As decisões de finalidade, base legal e retenção devem ser documentadas pelo controlador, com responsabilidades do fornecedor definidas em contrato.', 'SmallJP')
sources = json.loads((HERE/'legal-and-sources.json').read_text())['sources']
for source in sources:
    p(f'<b>[{escape(source["id"])}]</b> <link href="{escape(source["url"], {chr(34): "&quot;"})}" color="#07583D">{escape(source["title"])}</link>', 'SourceJP')
h('Rastreabilidade desta auditoria')
p('Código analisado: <b>josepazmattos/jp-entregaepi-v12</b>, revisão e5d6d6c. Scripts e resultados estão em <font face="Courier">audit/facial-20261030/</font>, em ramo separado da aplicação. O protótipo não é carregado pelo app e não constitui integração facial de produção.', 'SmallJP')
p('Arquivos de resultados: <font face="Courier">camera-results.json</font> e <font face="Courier">backend-results.json</font>. A análise consultou também a configuração e as cotas da conta AWS em modo de leitura. Nenhum cadastro biométrico real foi coletado neste estudo.', 'SmallJP')

def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(GREEN)
    canvas.rect(0,H-4*mm,W,4*mm,fill=1,stroke=0)
    logo = ROOT/'frontend/EntregaEPI/assets/logo-jp.png'
    if logo.exists():
        canvas.drawImage(str(logo),17*mm,H-23*mm,width=13*mm,height=13*mm,preserveAspectRatio=True,mask='auto')
    canvas.setFont('Helvetica-Bold',9)
    canvas.setFillColor(INK)
    canvas.drawString(33*mm,H-15*mm,'JP Segurança do Trabalho | EntregaEPI')
    canvas.setFont('Helvetica',8)
    canvas.setFillColor(MUTED)
    canvas.drawString(33*mm,H-20*mm,'Avaliação de alternativa facial - estudo antes da implantação')
    canvas.setStrokeColor(LINE)
    canvas.line(17*mm,17*mm,W-17*mm,17*mm)
    canvas.setFont('Helvetica',8)
    canvas.drawString(17*mm,12*mm,'30/10/2026 | Digital OU facial | NITGEN preservado')
    canvas.drawRightString(W-17*mm,12*mm,str(doc.page))
    canvas.restoreState()

doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=17*mm, leftMargin=17*mm, topMargin=31*mm, bottomMargin=23*mm, title='EntregaEPI - Avaliação de biometria facial em campo', author='JP Segurança do Trabalho', subject='Viabilidade, legislação, evidências e testes; digital ou facial por entrega')
doc.build(story,onFirstPage=chrome,onLaterPages=chrome)
print(OUT)
