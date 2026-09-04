import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { legacyRouter } from './legacy/index.js';

/**
 * Rotas de negocio. Tudo aqui dentro exige x-api-key — inclusive as rotas
 * portadas do VTEX IO, que la eram `public: true` (a protecao era a policy
 * do proprio VTEX IO, que nao existe fora dele).
 *
 * TODO(mapeamento): o de/para de campos do orderForm sera definido a partir
 * do payload real da requisicao. Ver README, secao "Mapeamento".
 */
export const apiRouter: Router = Router();

apiRouter.use(requireApiKey);
apiRouter.use(legacyRouter);
