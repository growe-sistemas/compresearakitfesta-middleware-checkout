import { Router } from 'express';
import { verifyCnpjRoute } from './documents.js';

/**
 * API v2 — as rotas novas, com contrato consistente
 * (`docs/04-contratos-v2.md`).
 *
 * Convive com `/middleware/checkout/*` (o porte fiel do app VTEX IO): o front
 * migra rota a rota, e nenhuma rota legada some antes de o `checkout-ui`
 * parar de chama-la em producao.
 *
 * Como as legadas, estas sao publicas — o checkout chama do navegador, onde
 * uma chave em bundle nao seria segredo. O endurecimento previsto (rate limit,
 * CORS restrito, vinculo com a sessao VTEX) esta em
 * `docs/04-contratos-v2.md`, secao 5.
 */
export const v2Router: Router = Router();

v2Router.post('/v2/documents/cnpj/verify', verifyCnpjRoute);
