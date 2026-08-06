import './env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter } from './auth.js';
import { googleRouter } from './google-auth.js';
import { stateRouter } from './state.js';
import { transcribeRouter } from './transcribe.js';
import { notifyRouter } from './notify/routes.js';
import { startNotifyWorker } from './notify/worker.js';
import { getDB } from './db.js';

const PROD = process.env.NODE_ENV === 'production';
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' })); /* estado + ícones de etiqueta em data URL */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  /* o ditado usa microfone; câmera/geolocalização nunca */
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (PROD) {
    /* HSTS/CSP só em produção: em dev o Vite serve o front (HMR usa inline
       scripts/websocket) e o HTML nem passa por este servidor */
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; '),
    );
  }
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/auth', googleRouter);
app.use('/api/state', stateRouter);
app.use('/api/transcribe', transcribeRouter);
app.use('/api/notify', notifyRouter);
app.get('/api/health', async (_req, res) => {
  try {
    await (await getDB()).query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

if (PROD) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

const port = Number(process.env.PORT ?? (PROD ? 5192 : 5193));
getDB()
  .then(() => {
    app.listen(port, () => console.log(`AgendaMestre ${PROD ? '(produção)' : '(api dev)'} na porta ${port}`));
    if (!process.env.NOTIFY_DISABLED) startNotifyWorker();
  })
  .catch((e) => {
    console.error('Falha ao iniciar o banco:', e);
    process.exit(1);
  });
