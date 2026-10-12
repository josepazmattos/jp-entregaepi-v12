import {stateFor} from './states.js';
import {sanitizeResponse} from './protocol.js';

const $ = id => document.getElementById(id);
let busy = false;
let ready = false;
let imageExpiry;

function clearImage() { clearTimeout(imageExpiry); $('finger-image').removeAttribute('src'); $('image-box').hidden = true; }
function render(code) {
  const [tone, title, detail, next] = stateFor(code);
  $('status').dataset.tone = tone;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('next-step').textContent = next;
}
async function run(action) {
  if (busy) return;
  busy = true; clearImage();
  $('verify').disabled = true; $('capture').disabled = true; $('finger').disabled = true;
  render(action === 'status' ? 'WORKING' : 'CAPTURING');
  try {
    const request = action === 'status' ? {action} : {action, finger:$('finger').value};
    const response = sanitizeResponse(await chrome.runtime.sendMessage(request), action === 'captureTest');
    ready = ['READY','CAPTURE_OK'].includes(response.code);
    render(response.code);
    $('version').textContent = response.agentVersion ? `Agente ${response.agentVersion}` : 'Piloto 0.1.0';
    if (response.code === 'CAPTURE_OK') {
      $('finger-image').src = response.image; $('image-box').hidden = false;
      imageExpiry = setTimeout(clearImage, 60000);
    }
  } catch { ready = false; render('CONNECTOR_ERROR'); }
  finally { busy = false; $('verify').disabled = false; $('capture').disabled = !ready; $('finger').disabled = false; }
}
$('verify').addEventListener('click', () => run('status'));
$('capture').addEventListener('click', () => run('captureTest'));
$('clear').addEventListener('click', clearImage);
window.addEventListener('pagehide', clearImage);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearImage(); });
// No background polling and no automatic capture when opening the popup.
