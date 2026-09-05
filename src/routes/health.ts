import { Router } from 'express';
import { DEPLOY_INFO } from '../config/build.js';

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
    // Aditivo: `status` continua sendo o unico campo que o Render olha.
    // O resto alimenta a pagina de status em `/`.
    ...DEPLOY_INFO,
  });
});
