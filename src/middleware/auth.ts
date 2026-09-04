import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../services/vtex/errors.js';

/** Comparacao em tempo constante, imune a diferenca de tamanho. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Protege as rotas de negocio: exige `x-api-key` igual a API_KEY.
 * O valor recebido nunca e logado nem devolvido no erro.
 */
export function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('x-api-key');

  if (header === undefined || header === '') {
    next(new AppError(401, 'MISSING_API_KEY', 'Header x-api-key ausente'));
    return;
  }

  if (!safeCompare(header, env.API_KEY)) {
    next(new AppError(401, 'INVALID_API_KEY', 'Header x-api-key invalido'));
    return;
  }

  next();
}
