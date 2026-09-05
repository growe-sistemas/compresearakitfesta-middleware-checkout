import { Router } from 'express';
import { legacyRouter } from './legacy/index.js';
import { v2Router } from './v2/index.js';
import { customersRouter } from './customers.js';

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

// v2 primeiro: rotas novas, contrato consistente (docs/04-contratos-v2.md).
apiRouter.use(v2Router);
// Porte fiel do app VTEX IO. Sai quando o front parar de chamar.
apiRouter.use(legacyRouter);
apiRouter.use(customersRouter);
