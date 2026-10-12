import {NATIVE_HOST} from './config.js';
import {allowedMessage, allowedWebsite, sanitizeResponse} from './protocol.js';

let inFlight = false;
let lastExternal = 0;

async function native(message) {
  if (inFlight) return {ok:false, code:'READER_BUSY'};
  inFlight = true;
  try {
    // No automatic retry: a capture can only start after a new explicit click.
    const reply = await new Promise((resolve, reject) => {
      const port = chrome.runtime.connectNative(NATIVE_HOST);
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true; clearTimeout(timer);
        port.disconnect();
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('Conector sem resposta')), message.action === 'captureTest' ? 35000 : 7000);
      port.onMessage.addListener(value => finish(null, value));
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        finish(new Error(error?.message || 'Conector desconectado'));
      });
      port.postMessage(message);
    });
    return sanitizeResponse(reply, message.action === 'captureTest');
  } catch (error) {
    const msg = String(error?.message || '');
    const code = /not found|not registered/i.test(msg) ? 'CONNECTOR_MISSING' : /forbidden|denied|not allowed/i.test(msg) ? 'CONNECTOR_BLOCKED' : 'CONNECTOR_ERROR';
    return {ok:false, code};
  } finally { inFlight = false; }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html') || !allowedMessage(message, true)) {
    reply({ok:false,code:'INVALID_REQUEST'}); return false;
  }
  native(message).then(reply); return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (!allowedWebsite(sender) || !allowedMessage(message, false)) {
    reply({ok:false,code:'INVALID_REQUEST'}); return false;
  }
  if (Date.now() - lastExternal < 3000) { reply({ok:false,code:'CHECKING'}); return false; }
  lastExternal = Date.now();
  native(message).then(reply); return true;
});
