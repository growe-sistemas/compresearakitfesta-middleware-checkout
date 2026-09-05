import express, { Router, type RequestHandler } from 'express';
import { logger } from '../../config/logger.js';
import { requireApiKey } from '../../middleware/auth.js';
import { CHECKOUT_ROUTES, type HttpVerb } from './routes.js';

/**
 * Registro das rotas sob `/middleware/checkout/*`.
 *
 * Este arquivo nao decide nada: ele percorre a tabela de `routes.ts` e
 * registra. Rota nova se declara la, nao aqui.
 */

/**
 * O app VTEX IO lia o corpo com `co-body` dentro de cada handler, aceitando
 * JSON mesmo sem `Content-Type` correto. O curinga abaixo reproduz isso.
 *
 * Aplicado em TODA rota, inclusive nas de leitura: sem corpo o parser e um
 * no-op, e varias rotas herdadas leem parametros do corpo mesmo respondendo a
 * `GET`. Uma regra vale mais que uma excecao por verbo.
 */
const parseBody = express.json({ limit: '1mb', type: '*/*' });

/** `HttpVerb` -> metodo do Router. Exaustivo por construcao, sem `switch`. */
const REGISTER = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  DELETE: 'delete',
  ALL: 'all',
} as const satisfies Record<HttpVerb, keyof Pick<Router, 'get' | 'post' | 'put' | 'delete' | 'all'>>;

export const checkoutRouter: Router = Router();

for (const route of CHECKOUT_ROUTES) {
  const chain: RequestHandler[] =
    route.auth === 'apiKey' ? [requireApiKey, parseBody] : [parseBody];

  for (const method of route.methods) {
    checkoutRouter[REGISTER[method]](route.path, ...chain, route.handler);
  }

  if (route.deprecated !== undefined) {
    logger.debug(
      { path: route.path, methods: route.methods, reason: route.deprecated },
      'Rota depreciada registrada',
    );
  }
}
