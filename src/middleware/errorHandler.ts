import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError, UpstreamError } from '../services/vtex/errors.js';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

/** 404 para rota inexistente — antes do errorHandler na cadeia. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Rota nao encontrada: ${req.method} ${req.path}`));
}

/**
 * Tratamento centralizado. Nada de stack trace ou corpo da VTEX vazando
 * para o cliente em producao — isso fica so no log.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = res.getHeader('x-request-id');
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Erro interno';
  let details: unknown;

  if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Parametros invalidos';
    details = err.issues;
  } else if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  }

  const logPayload = {
    err,
    status,
    code,
    method: req.method,
    path: req.path,
    ...(err instanceof UpstreamError
      ? { upstream: err.upstream, upstreamStatus: err.upstreamStatus, upstreamBody: err.upstreamBody }
      : {}),
  };

  if (status >= 500) {
    logger.error(logPayload, 'Requisicao falhou');
  } else {
    logger.warn(logPayload, 'Requisicao rejeitada');
  }

  // Em producao, mascara so o que nao foi escrito para o cliente ler:
  // erro desconhecido (500 generico) e detalhe do upstream VTEX (que carrega
  // o path interno da chamada). Mensagem de AppError nossa vai como esta.
  const mensagemDeliberada = err instanceof AppError && !(err instanceof UpstreamError);
  const mascarar = env.NODE_ENV === 'production' && status >= 500 && !mensagemDeliberada;

  const body: ErrorBody = {
    error: {
      code,
      message: mascarar ? 'Erro interno' : message,
      ...(typeof requestId === 'string' ? { requestId } : {}),
      ...(details !== undefined && status < 500 ? { details } : {}),
    },
  };

  res.status(status).json(body);
}
