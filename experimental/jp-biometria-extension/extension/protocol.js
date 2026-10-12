export const ALLOWED_FINGERS = new Set(['R_THUMB','R_INDEX','R_MIDDLE','R_RING','R_LITTLE','L_THUMB','L_INDEX','L_MIDDLE','L_RING','L_LITTLE']);

export function allowedMessage(message, captureAllowed = false) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message).sort().join(',');
  return (message.action === 'status' && keys === 'action') ||
    (captureAllowed && message.action === 'captureTest' && keys === 'action,finger' && ALLOWED_FINGERS.has(message.finger));
}

export function allowedWebsite(sender) {
  try {
    const url = new URL(sender.url);
    return ['https://www.jptreinamentos.com.br', 'https://jptreinamentos.com.br'].includes(url.origin) &&
      (!sender.origin || sender.origin === url.origin) && !url.username && !url.password &&
      (url.pathname === '/EntregaEPI' || url.pathname.startsWith('/EntregaEPI/')) && sender.frameId === 0;
  } catch { return false; }
}

const CODES = new Set(['READY','CAPTURE_OK','CONNECTOR_MISSING','CONNECTOR_BLOCKED','CONNECTOR_ERROR','AGENT_SETUP_REQUIRED','AGENT_OFFLINE','MULTIPLE_AGENTS','AGENT_CHANGED','SDK_NOT_FOUND','SDK_UNAVAILABLE','READER_NOT_READY','READER_BUSY','CHECKING','AGENT_INCOMPATIBLE','CAPTURE_TIMEOUT','CAPTURE_FAILED','IMAGE_MISSING','INVALID_REQUEST']);

export function sanitizeResponse(value, allowImage = false) {
  if (!value || typeof value !== 'object' || !CODES.has(value.code)) return {ok:false, code:'CONNECTOR_ERROR'};
  const out = {ok: ['READY','CAPTURE_OK'].includes(value.code), code:value.code};
  if (typeof value.connectorVersion === 'string' && /^[\w.+-]{1,40}$/.test(value.connectorVersion)) out.connectorVersion = value.connectorVersion;
  if (typeof value.agentVersion === 'string' && /^[\w.+-]{1,40}$/.test(value.agentVersion)) out.agentVersion = value.agentVersion;
  if (Number.isInteger(value.port) && value.port >= 8789 && value.port <= 8799) out.port = value.port;
  if (value.code === 'CAPTURE_OK') {
    if (!allowImage || typeof value.image !== 'string' || value.image.length > 210000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.image) || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 32 || value.height < 32 || value.width > 2048 || value.height > 2048) return {ok:false,code:'IMAGE_MISSING'};
    out.image = value.image; out.width = value.width; out.height = value.height;
  }
  return out;
}
