import express from 'express';
import cors from 'cors';
import empresasRoutes from './routes/empresas.routes.js';
import trabalhadoresRoutes from './routes/trabalhadores.routes.js';
import episRoutes from './routes/epis.routes.js';
import fichasRoutes from './routes/fichas.routes.js';
import caepiRoutes from './routes/caepi.routes.js';
import auditoriaRoutes from './routes/auditoria.routes.js';
import { requireAuth } from './middleware/auth.js';
import { probeStorage } from './db/store.js';
import { caepiStatus } from './services/caepi.service.js';

const app = express();

app.disable('x-powered-by');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://www.jptreinamentos.com.br,https://jptreinamentos.com.br').split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: false, allowedHeaders: ['content-type', 'authorization', 'x-empresa-id'] }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/health', async (req, res) => {
  const storage = await probeStorage();
  res.status(storage.ready ? 200 : 503).json({
    ok: storage.ready,
    service: 'JP EntregaEPI V12 API',
    version: process.env.APP_VERSION || '12.8.1',
    buildSha: process.env.BUILD_SHA || null,
    mode: storage.mode,
    durable: storage.durable,
    storageReady: storage.ready,
    caepi: caepiStatus()
  });
});

app.use('/api/caepi', caepiRoutes);
app.use('/api', requireAuth);
app.use('/api/empresas', empresasRoutes);
app.use('/api/trabalhadores', trabalhadoresRoutes);
app.use('/api/epis', episRoutes);
app.use('/api/fichas', fichasRoutes);
app.use('/api/auditoria', auditoriaRoutes);

app.use((req, res) => res.status(404).json({ ok: false, error: 'Rota não encontrada', path: req.path }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  const exposed = status < 500 || error.code === 'PERSISTENCIA_NAO_CONFIGURADA' || error.code === 'AUTORIZACAO_NAO_CONFIGURADA' || error.code === 'CAEPI_BASE_INDISPONIVEL';
  res.status(status).json({ ok: false, error: exposed ? error.message : 'Não foi possível concluir a operação. Tente novamente.', code: error.code || (status === 500 ? 'ERRO_INTERNO' : 'REQUISICAO_INVALIDA') });
});

export default app;
