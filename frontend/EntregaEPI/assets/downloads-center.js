// Shared download center. No changes to company data, drivers or browser settings.
(() => {
  'use strict';
  const host = document.getElementById('downloadsBiometria');
  if (!host || host.dataset.downloadsReady) return;
  host.dataset.downloadsReady = 'true';
  const base = '/EntregaEPI/';
  const installer = base + 'updates/12.10.1-unico1/JP-Biometria-Instalador-Unico.exe';
  const repair = base + 'updates/12.10.1-unico1/JP-Biometria-Reparador-12.10.1.exe';
  const publicPage = base + 'downloads.html';
  const titleTag = document.body.classList.contains('jp-downloads-page') ? 'h1' : 'h2';
  const guides = {
    installation: {title:'Primeira instalação', steps:[
      'Instale manualmente o driver do Hamster DX indicado pelo fabricante para esse Windows. Siga o guia quanto ao momento de conectar o USB.',
      'Baixe o INSTALADOR COMPLETO e execute no mesmo usuário do Windows que acessa o JP EntregaEPI.',
      'Aguarde a mensagem final. Depois abra Biometria, clique em VERIFICAR LEITOR e faça TESTAR CAPTURA.'
    ], note:'O instalador inclui Java, os componentes NITGEN e o agente JP. Se o driver estiver ausente, o pacote também pode solicitar a instalação dele; prepare o driver manualmente antes.'},
    install_failed: {title:'AGENT_INSTALL_FAILED — instalação não concluída', steps:[
      'Baixe o REPARADOR DO COMPONENTE e execute diretamente o arquivo baixado, no mesmo usuário do Windows.',
      'O reparador tenta instalar e iniciar o agente JP e apresenta uma mensagem mais detalhada se houver falha.',
      'Se aparecer outro erro, envie a mensagem completa ao suporte JP. Se iniciar, volte ao aplicativo e verifique o leitor.'
    ], note:'Esse código é genérico. Ele não confirma defeito no leitor nem identifica sozinho a causa da falha.'},
    missing_file: {title:'Windows não encontrou JPBiometria.exe', steps:[
      'O componente não está disponível na pasta esperada desse usuário. Baixe o REPARADOR DO COMPONENTE nesta página.',
      'Abra o arquivo recém-baixado com dois cliques no mesmo usuário do Windows que utiliza o aplicativo.',
      'Se o arquivo desaparecer ou for bloqueado, confira o aviso do antivírus e envie a mensagem ao suporte JP.'
    ], note:'Não é necessário repetir o comando para abrir o arquivo ausente. A causa pode ser instalação interrompida, outro perfil de usuário ou remoção do arquivo.'},
    network: {title:'BIO_NETWORK — sem comunicação com o componente', steps:[
      'No aplicativo, abra Biometria e clique em INICIAR JP BIOMETRIA. Depois clique em VERIFICAR LEITOR.',
      'Se o agente não iniciar ou o Windows não encontrar o arquivo, execute o REPARADOR DO COMPONENTE.',
      'Se o agente iniciou, confira a permissão do site para rede local ou aplicativos no dispositivo no Chrome. Autorize somente o site JP que você está utilizando e verifique novamente.'
    ], note:'Falhas nas portas 8789 a 8799 são tentativas de localizar um único agente. O relatório, sozinho, não prova que o driver está com problema.'},
    permission: {title:'BIO_PERMISSION — permissão do navegador', steps:[
      'No Chrome, abra o JP EntregaEPI e clique no ícone de informações/permissões à esquerda do endereço.',
      'Em Configurações do site, confira a permissão de acesso à rede local ou a aplicativos no dispositivo, conforme a versão do Chrome.',
      'Volte à página e clique em PERMITIR E VERIFICAR LEITOR. Se a permissão for gerenciada pela empresa, solicite a verificação ao responsável de TI.'
    ], note:'A autorização do navegador e a instalação do agente são etapas diferentes.'},
    sdk: {title:'SDK_NOT_FOUND / JAVA_NOT_FOUND — componente ausente', steps:[
      'Execute o INSTALADOR COMPLETO, que contém Java e os componentes NITGEN necessários ao agente.',
      'Use o mesmo usuário do Windows que abre o aplicativo. O reparador isolado não instala Java, SDK ou driver.',
      'Se a instalação terminar com AGENT_INSTALL_FAILED, execute o REPARADOR DO COMPONENTE para obter o motivo detalhado.'
    ], note:'Para JAVA_ARCH_MISMATCH ou SDK_LOAD_FAILED, envie o código completo ao suporte caso o instalador não resolva.'},
    nitgen: {title:'NITGEN_15 / NITGEN_24 — SDK não inicializou', steps:[
      'Feche os programas que estiverem utilizando o leitor e conclua qualquer captura em andamento.',
      'Execute o REPARADOR DO COMPONENTE uma vez para verificar os componentes já instalados.',
      'Se o código continuar, envie a mensagem completa ao suporte JP para conferir o SDK e o driver da máquina.'
    ], note:'Repetir a instalação várias vezes não confirma a correção desses códigos.'},
    reader: {title:'Leitor não encontrado ou ocupado', steps:[
      'Conclua qualquer captura em andamento e feche o SOC, NFD ou outro programa que esteja usando o leitor.',
      'Com o driver já instalado, confira a conexão USB do Hamster DX.',
      'No JP EntregaEPI, clique em VERIFICAR LEITOR e depois em TESTAR CAPTURA. Se continuar, confira o driver no guia do fabricante.'
    ], note:'A indicação de componente conectado só confirma a comunicação. O funcionamento do leitor precisa ser confirmado com uma captura.'},
    blocked: {title:'Download bloqueado ou arquivo removido', steps:[
      'Confira o nome do arquivo e a mensagem apresentada pelo Chrome ou pela Segurança do Windows.',
      'Se houver uma detecção de ameaça, envie o nome da detecção ao suporte JP antes de executar o arquivo.',
      'O suporte deve conferir o arquivo e o bloqueio. Evite desativar o antivírus ou as proteções do Windows para instalar.'
    ], note:'Os pacotes disponibilizados aqui são os componentes JP já publicados. Disponibilizar o download não remove avisos de segurança nem confirma a instalação nessa máquina.'}
  };
  host.classList.add('jp-downloads');
  host.innerHTML = `
    <div class="jp-downloads-heading"><div><span class="jp-downloads-eyebrow">SUPORTE À INSTALAÇÃO</span><${titleTag} id="downloadsTitle">Downloads</${titleTag}><p>Escolha o arquivo conforme a situação deste computador.</p></div><a class="jp-downloads-share" href="${publicPage}" target="_blank" rel="noopener">ABRIR CENTRAL DE DOWNLOADS</a></div>
    <p class="jp-downloads-platform">Windows 10 e 11 · 64 bits · Intel/AMD · NITGEN Hamster DX</p>
    <div class="jp-downloads-grid">
      <article class="jp-download-card jp-download-card-primary"><span class="jp-download-tag">PRIMEIRA INSTALAÇÃO</span><h3>Instalador completo</h3><p>Prepara o agente JP, o Java e os componentes NITGEN necessários à comunicação com o leitor.</p><p class="jp-download-use"><strong>Use quando:</strong> for instalar em uma máquina nova ou houver SDK/Java ausente.</p><div class="jp-download-meta">Versão 12.10.1-unico1 <span>56,2 MiB</span></div><a id="downloadBiometriaLink" data-jp-download class="btn btn-primary" href="${installer}" download="JP-Biometria-Instalador-Unico.exe">BAIXAR INSTALADOR COMPLETO</a><small>Instale manualmente o driver compatível antes de executar.</small></article>
      <article class="jp-download-card"><span class="jp-download-tag">FALHA NA INSTALAÇÃO</span><h3>Reparador do componente</h3><p>Reinstala e tenta iniciar o agente JP. Exibe o motivo detalhado se o reparo não puder ser concluído.</p><p class="jp-download-use"><strong>Use quando:</strong> aparecer AGENT_INSTALL_FAILED, arquivo não encontrado ou o agente não iniciar.</p><div class="jp-download-meta">Versão 12.10.1 <span>7,6 MiB</span></div><a id="downloadReparadorLink" data-jp-download class="btn btn-secondary" href="${repair}" download="JP-Biometria-Reparador-12.10.1.exe">BAIXAR REPARADOR</a><small>Utiliza o Java, o SDK e o driver já instalados. É o componente original do pacote completo.</small></article>
    </div>
    <div class="jp-driver-card"><div><h3>Driver do Hamster DX</h3><p>Instalação manual conforme o modelo do leitor e o Windows da máquina. Se já funciona, mantenha o driver atual. A central do fabricante pode solicitar cadastro.</p></div><div class="jp-driver-links"><a href="https://suporte.fingertech.com.br/" target="_blank" rel="noopener">DRIVER E GUIA NO FABRICANTE</a></div></div>
    <div class="jp-download-help"><label for="jpDownloadProblem">Qual situação apareceu?</label><select id="jpDownloadProblem">
      <option value="installation">Vou instalar pela primeira vez</option><option value="install_failed">AGENT_INSTALL_FAILED</option><option value="missing_file">Windows não encontrou JPBiometria.exe</option><option value="network">BIO_NETWORK / sem conexão</option><option value="permission">BIO_PERMISSION / acesso local bloqueado</option><option value="sdk">SDK ou Java não encontrado</option><option value="nitgen">NITGEN_15 / NITGEN_24</option><option value="reader">Leitor não encontrado ou ocupado</option><option value="blocked">Download bloqueado ou arquivo removido</option>
    </select><div id="jpDownloadGuidance" role="status" aria-live="polite" aria-atomic="true"></div></div>
    <div class="jp-download-final"><div><strong>Depois de instalar, confirme o funcionamento.</strong><p>Execute no mesmo usuário do Windows que usa o aplicativo. Finalize com VERIFICAR LEITOR e TESTAR CAPTURA.</p></div><button id="jpDownloadsTest" type="button" class="btn btn-secondary">ABRIR BIOMETRIA</button></div>
    <p class="jp-download-footnote">Disponível para Master e empresas. A conclusão do download não confirma a instalação ou a captura. <a href="https://support.google.com/chrome/answer/114662?hl=pt-BR" target="_blank" rel="noopener">Ajuda oficial de permissões do Chrome</a>.</p>`;
  const select = document.getElementById('jpDownloadProblem');
  function renderGuide() {
    const guide = guides[select.value] || guides.installation;
    const target = document.getElementById('jpDownloadGuidance');
    target.replaceChildren();
    const title = document.createElement('h3'); title.textContent = guide.title;
    const list = document.createElement('ol');
    guide.steps.forEach(step => { const item = document.createElement('li'); item.textContent = step; list.append(item); });
    const note = document.createElement('p'); note.className = 'jp-guide-note'; note.textContent = guide.note;
    target.append(title, list, note);
  }
  select.addEventListener('change', renderGuide); renderGuide();
  host.addEventListener('click', event => {
    if (!event.target.closest('[data-jp-download]')) return;
    // Reuse the app's bounded, read-only installation monitor for both downloads.
    if (typeof window.resumeInstallationWatch === 'function') {
      try { sessionStorage.setItem('jp-biometria-install-until', String(Date.now() + 15 * 60 * 1000)); } catch { return; }
      window.setTimeout(() => window.resumeInstallationWatch(), 5000);
    }
  });
  document.getElementById('jpDownloadsTest').addEventListener('click', () => {
    if (typeof window.goScreen === 'function') window.goScreen('biometria');
    else window.location.assign(base);
  });
  const bioHelp = document.getElementById('bioRepairLink')?.closest('p');
  if (bioHelp && !document.getElementById('bioDownloadsCenter')) {
    const link = document.createElement('button');
    link.id = 'bioDownloadsCenter'; link.type = 'button'; link.className = 'text-button';
    link.textContent = 'VER DOWNLOADS E REPARADORES';
    link.addEventListener('click', () => { window.goScreen('config'); host.scrollIntoView({block:'start'}); select.focus({preventScroll:true}); });
    bioHelp.after(link);
  }
})();
