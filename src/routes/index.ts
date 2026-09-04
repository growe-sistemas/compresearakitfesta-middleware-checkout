import { Router } from 'express';
import { legacyRouter } from './legacy/index.js';

/**
 * Rotas de negocio.
 *
 * A autenticacao NAO e aplicada aqui em bloco: cada rota portada declara no
 * manifesto se e publica (como o `public: true` do service.json do app VTEX
 * IO) ou se exige `x-api-key`. Praticamente todas sao chamadas pelo navegador
 * — checkout e componentes React da loja —, onde uma chave em bundle nao seria
 * segredo.
 *
 * TODO(mapeamento): o de/para de campos do orderForm sera definido a partir
 * do payload real da requisicao. Ver README, secao "Mapeamento".
 */
export const apiRouter: Router = Router();

apiRouter.use(legacyRouter);
