import app from './app.js';

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`JP EntregaEPI V12 API rodando em http://localhost:${port}`));
