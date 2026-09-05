import { Router } from 'express';
import { checkoutRouter } from './checkout/index.js';
import { v2Router } from './v2/index.js';
import { customersRouter } from './customers.js';

/**
 * Rotas de negocio.
 *
 * A autenticacao NAO e aplicada aqui em bloco: cada rota do checkout declara
 * no manifesto se e publica ou se exige `x-api-key`. Praticamente todas sao chamadas pelo navegador
 * — checkout e componentes React da loja —, onde uma chave em bundle nao seria
 * segredo.
 *
 * TODO(mapeamento): o de/para de campos do orderForm sera definido a partir
 * do payload real da requisicao. Ver README, secao "Mapeamento".
 */
export const apiRouter: Router = Router();

// v2 primeiro: rotas novas, contrato consistente (docs/04-contratos-v2.md).
apiRouter.use(v2Router);
// Rotas do checkout, sob /middleware/checkout/*.
apiRouter.use(checkoutRouter);
apiRouter.use(customersRouter);
