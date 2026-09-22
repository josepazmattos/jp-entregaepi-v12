import express from 'express';
import cors from 'cors';
import empresasRoutes from './routes/empresas.routes.js';
import trabalhadoresRoutes from './routes/trabalhadores.routes.js';
import episRoutes from './routes/epis.routes.js';
import fichasRoutes from './routes/fichas.routes.js';
import caepiRoutes from './routes/caepi.routes.js';
import auditoriaRoutes from './routes/auditoria.routes.js';

const app = express();

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '20mb' }));
app.use(express.text({ limit: '20mb', type: ['text/*'] }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'JP EntregaEPI V12 API', version: '12.0.0', mode: process.env.TABLE_NAME ? 'dynamodb' : 'memory' });
});

app.use('/api/empresas', empresasRoutes);
app.use('/api/trabalhadores', trabalhadoresRoutes);
app.use('/api/epis', episRoutes);
app.use('/api/fichas', fichasRoutes);
app.use('/api/caepi', caepiRoutes);
app.use('/api/auditoria', auditoriaRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Rota não encontrada', path: req.path });
});

export default app;
