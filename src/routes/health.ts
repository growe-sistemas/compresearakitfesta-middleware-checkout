import { Router } from 'express';

export const healthRouter: Router = Router();

/**
 * Health check do Render. Sem autenticacao e sem tocar na VTEX:
 * responde sobre ESTE processo, nao sobre o upstream.
 */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
