import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './src/server/routes/api.ts';
import { logStructured } from './src/server/services/audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.set('trust proxy', 1);

  // Security headers compatible with AI Studio iframe (no X-Frame-Options: DENY)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Structured API routes
  app.use('/api', apiRouter);

  // JSON error handler for API routes
  app.use('/api', (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logStructured('error', 'unhandled_api_error', { message: err.message });
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logStructured('info', 'server_started', {
      port: PORT,
      env: process.env.NODE_ENV || 'development',
    });
  });
}

startServer().catch((err) => {
  console.error('Failed to start CoverPulse server:', err);
  process.exit(1);
});
