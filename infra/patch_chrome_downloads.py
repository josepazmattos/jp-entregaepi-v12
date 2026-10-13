"""Patch only download wording/URLs in a freshly read index; preserve all other bytes."""
from pathlib import Path
import argparse

OLD='updates/12.10.0-bio2/JP-Biometria-Setup-12.10.0-bio2.exe'
NEW='updates/12.10.0-chrome1/JP-Biometria-Windows-10-11.exe'
REPLACEMENTS={
 OLD:NEW,
 'download>Atualizar JP Biometria</a>. Windows 64 bits · Hamster DX. Mantém o driver, os SDKs e o Java existentes. Use somente quando o aplicativo indicar que o componente precisa de atualização.':
 'download>Instalar JP Biometria</a>. Chrome · Windows 10 (32/64 bits) e Windows 11 (64 bits), Intel/AMD. Inclui SDK e Java. O driver do leitor deve estar instalado manualmente.',
 'Atualiza o agente em computadores com driver NITGEN, SDK e Java já instalados. As digitais cadastradas no aplicativo são preservadas.':
 'Instala o agente JP, o SDK NITGEN e o Java necessário em um único arquivo. Seleciona automaticamente os componentes de 32 ou 64 bits. As digitais cadastradas no aplicativo são preservadas.',
 'Versão 12.10.0-bio2 · Windows 64 bits · 7,9 MB':
 'Pacote 12.10.0-chrome1 · Chrome · Windows 10 (32/64 bits) e Windows 11 (64 bits), Intel/AMD · 103,5 MB',
 'download>Baixar JP Biometria</a>': 'download>Baixar instalador Windows 10 e 11</a>',
 'Abra o arquivo baixado e siga a instalação. Ao voltar ao aplicativo, a conexão será verificada automaticamente. Em uma máquina nova, prepare primeiro o driver, o SDK e o Java.':
 'Instale manualmente o driver do Hamster DX, abra o arquivo baixado e volte ao Chrome para Verificar leitor e Testar captura. Permita a conexão local se o navegador solicitar. Windows ARM não está incluído. A instalação dos componentes não confirma uma captura física. Se aparecer NITGEN_15, envie o código ao suporte: repetir a instalação não corrige essa recusa do SDK.'
}

def patch(text):
    for old,new in REPLACEMENTS.items():
        count=text.count(old);expected=2 if old==OLD else 1
        if count!=expected:raise ValueError('Published download section changed; inspect before updating: '+old[:75])
        text=text.replace(old,new)
    return text

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('destination',type=Path);a=p.parse_args()
    a.destination.write_text(patch(a.source.read_text(encoding='utf-8')),encoding='utf-8')
if __name__=='__main__':main()
