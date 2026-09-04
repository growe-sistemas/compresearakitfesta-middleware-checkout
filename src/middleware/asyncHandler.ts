import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Encaminha rejeicao de handler async para o errorHandler.
 * (Express 4 nao faz isso sozinho — uma promise rejeitada penduraria a
 * requisicao ate o timeout.)
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
