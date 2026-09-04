import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger.js';

/** Propaga (ou cria) um x-request-id para correlacionar log e resposta. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming !== undefined && incoming !== '' ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  next();
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const header = res.getHeader('x-request-id');
    return typeof header === 'string' ? header : String(req.id ?? randomUUID());
  },
  // O errorHandler ja loga as falhas; aqui so o resumo de acesso.
  customLogLevel: (_req, res, err) => {
    if (err !== undefined || res.statusCode >= 500) return 'silent';
    if (res.statusCode >= 400) return 'silent';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => req.url === '/health',
  },
});
