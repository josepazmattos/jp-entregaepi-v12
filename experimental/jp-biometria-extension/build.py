#!/usr/bin/env python3
"""Build isolated pilot; never deploy or touch the existing JP runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
VERSION = "0.1.0"

def create_preview():
    html = (ROOT / "extension/popup.html").read_text()
    popup = html.split('<body class="popup">', 1)[1].split('<script type="module"', 1)[0]
    png = (ROOT / 'extension/icons/jp-48.png').read_bytes()
    import base64
    popup = popup.replace('icons/jp-48.png', 'data:image/png;base64,' + base64.b64encode(png).decode())
    popup = popup.replace('href="guide.html"', 'href="#instalacao"').replace('target="_blank" rel="noopener">Ajuda', '>Ajuda')
    states = (ROOT / 'extension/states.js').read_text().replace('export const', 'const').replace('export function', 'function')
    style = (ROOT / 'extension/style.css').read_text()
    doc = r'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modelo JP Biometria · demonstração</title><style>__CSS__
body{background:#f1f5f0}.demo-top{max-width:1100px;margin:auto;padding:32px 30px;display:flex;align-items:center;justify-content:space-between}.demo-top strong{font-size:16px}.demo-top span{font-size:11px;letter-spacing:1px;color:#6e7d71}.layout{max-width:1100px;margin:18px auto 64px;display:grid;grid-template-columns:1fr 380px;gap:80px;padding:0 30px}.intro-col{padding-top:25px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:1.7px;color:#43815a}.intro-col h1{font-size:53px;line-height:1.06;letter-spacing:-2.5px;max-width:480px;margin:20px 0}.intro-col>p{font-size:17px;max-width:440px}.scenario{margin-top:34px;padding:22px;background:#fff;border-radius:14px;border:1px solid var(--line);max-width:420px}.scenario label{display:block;font-weight:700;font-size:12px;margin-bottom:10px}.scenario p{font-size:11px;margin-top:10px}.browser-shell{background:white;border-radius:20px;box-shadow:0 16px 60px #183d2814;overflow:hidden;border:1px solid #d9e3da}.browser-bar{background:#f9faf8;font-size:10px;color:#869286;border-bottom:1px solid #edf1eb;padding:12px 20px;display:flex;justify-content:space-between}.popup{width:378px}.pilot-note{font-size:11px;line-height:1.6;max-width:420px;margin-top:22px}.pilot-note strong{color:#4a6753}#instalacao{max-width:1040px;margin:0 auto 60px;padding:32px;border:1px solid var(--line);border-radius:18px;background:white}#instalacao h2{font-size:25px;margin:0 0 20px}.install-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:25px}.install-grid b{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--pale);margin-bottom:10px}.install-grid h3{font-size:14px;margin:0 0 8px}.install-grid p{font-size:12px}.scope{font-size:12px;margin-top:25px;border-top:1px solid var(--line);padding-top:18px}#scenario-msg{font-size:11px;margin-top:10px;color:#7a571d}body.preview #capture:disabled{opacity:.55}@media(max-width:850px){.layout{grid-template-columns:1fr;gap:28px;max-width:600px}.intro-col h1{font-size:42px}.browser-shell{width:380px;max-width:100%;margin:auto}.demo-top{padding:22px}.demo-top span{display:none}.install-grid{grid-template-columns:1fr}#instalacao{margin:0 20px 40px}.intro-col{padding:0}.scenario{max-width:none}.popup{width:100%}}
</style></head><body class="preview"><div class="demo-top"><strong>JP · EntregaEPI</strong><span>MODELO DE EXTENSÃO / 0.1.0</span></div><div class="layout"><section class="intro-col"><span class="eyebrow">MENOS ETAPAS. MAIS CLAREZA.</span><h1>Uma conexão.<br>O próximo passo<br>sempre claro.</h1><p>Verifique o leitor e saiba o que fazer, em um painel compacto ao lado do aplicativo.</p><div class="scenario"><label for="scenario">Experimente uma situação</label><select id="scenario"><option value="READY">Leitor disponível</option><option value="CONNECTOR_MISSING">Conector ainda não instalado</option><option value="AGENT_OFFLINE">Agente JP fechado</option><option value="SDK_NOT_FOUND">SDK NITGEN ausente</option><option value="READER_NOT_READY">Leitor desconectado</option><option value="READER_BUSY">Leitor ocupado no NFD</option><option value="IMAGE_MISSING">Captura sem imagem válida</option></select><p>Clique em Verificar leitor no painel para visualizar a orientação.</p></div><p class="pilot-note"><strong>Demonstração simulada.</strong> Esta página não acessa o computador, o leitor ou dados de trabalhadores. O pacote contém a extensão real para o teste assistido no Windows.</p></section><section class="browser-shell"><div class="browser-bar"><span>EXTENSÕES DO NAVEGADOR</span><span>JP BIOMETRIA</span></div><div class="popup">__POPUP__</div></section></div><section id="instalacao"><h2>Instalação proposta para os clientes</h2><div class="install-grid"><div><b>1</b><h3>Driver instalado pela equipe</h3><p>O driver do Hamster DX segue manual, atendendo às especificações da máquina.</p></div><div><b>2</b><h3>Extensão + conector JP</h3><p>A versão final poderá ter a extensão na loja e um conector assinado, instalado uma única vez.</p></div><div><b>3</b><h3>Verificar e usar</h3><p>O painel identifica o estado e orienta a próxima ação. O usuário abre o aplicativo e segue seu trabalho.</p></div></div><p class="scope"><strong>Neste piloto:</strong> carga manual da extensão e conector sem assinatura de distribuição. Requer o agente JP já funcionando. Cadastro, comparação de digitais e certificados continuam no fluxo atual do aplicativo.</p></section><script>__STATES__
const $=id=>document.getElementById(id);let busy=false;
function render(code){const [tone,title,detail,next]=stateFor(code);$('status').dataset.tone=tone;$('status-title').textContent=title;$('status-detail').textContent=detail;$('next-step').textContent=next;}
$('verify').onclick=()=>{if(busy)return;busy=true;$('verify').disabled=true;$('capture').disabled=true;render('WORKING');setTimeout(()=>{const code=$('scenario').value;render(code);$('capture').disabled=code!=='READY';$('verify').disabled=false;busy=false;},450)};
$('scenario').onchange=()=>{$('capture').disabled=true;render('INITIAL')};
$('capture').onclick=()=>{render('INITIAL');$('status-title').textContent='A captura exige o leitor real';$('status-detail').textContent='Use a extensão instalada no Windows para esse teste.';$('next-step').textContent='Esta demonstração não gera nem simula uma imagem de digital.';$('capture').disabled=true;};
$('clear').onclick=()=>{$('image-box').hidden=true};
</script></body></html>'''
    doc = doc.replace('__CSS__',style).replace('__POPUP__',popup).replace('__STATES__',states)
    (ROOT/'docs/modelo.html').write_text(doc)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--go',default='go');args=parser.parse_args()
    create_preview()
    dist=ROOT/'dist';dist.mkdir(exist_ok=True)
    exe=dist/'JP-Biometria-Conector-Piloto.exe'
    env={**os.environ,'GOOS':'windows','GOARCH':'amd64','CGO_ENABLED':'0'}
    subprocess.run([args.go,'build','-trimpath','-ldflags=-s -w -H=windowsgui','-o',str(exe),'.'],cwd=ROOT/'connector',env=env,check=True)
    # The index opens locally and links to the actual guide without scripts or downloads.
    (dist/'LEIA-PRIMEIRO.html').write_text('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>JP Biometria · Piloto</title><style>body{font:17px system-ui;max-width:720px;margin:70px auto;padding:25px;color:#17372b;line-height:1.6}a{color:#185b40}</style><h1>JP Biometria · Piloto 0.1.0</h1><p>Antes de executar o conector, leia o guia. Este pacote exige o agente JP já funcionando no Windows x64 e não inclui driver ou SDK.</p><p><a href="extension/guide.html">Abrir guia de instalação</a></p><p><a href="docs/modelo.html">Ver demonstração visual simulada</a></p><p><a href="docs/TESTES.md">Consultar resultados e limites dos testes</a></p></html>')
    archive=dist/f'JP-Biometria-Extensao-Piloto-{VERSION}.zip'
    files=[(p,str(p.relative_to(ROOT))) for p in (ROOT/'extension').rglob('*') if p.is_file()]
    files += [(exe,exe.name),(dist/'LEIA-PRIMEIRO.html','LEIA-PRIMEIRO.html'),(ROOT/'docs/modelo.html','docs/modelo.html'),(ROOT/'README.md','README.md')]
    for extra in ['docs/TESTES.md']:
        if (ROOT/extra).exists():files.append((ROOT/extra,extra))
    checksums=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+name+'\n' for p,name in sorted(files,key=lambda pair:pair[1]))
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p,name in files:z.write(p,name)
        z.writestr('SHA256SUMS.txt',checksums)
    print(json.dumps({'archive':str(archive),'size':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'connector_sha256':hashlib.sha256(exe.read_bytes()).hexdigest()},indent=2))

if __name__=='__main__':main()
