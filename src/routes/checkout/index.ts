import express, { Router, type RequestHandler } from 'express';
import { requireApiKey } from '../../middleware/auth.js';
import { verifyCnpjRoute } from './cnpj.js';
import { discardCorporateData, setCorporateData } from './corporateData.js';
import { setBirthDateCustomData } from './customData.js';
import { getEmployee } from './employee.js';
import { createGiftCard, getGiftCardInfoFromMD } from './giftCard.js';
import { getDataInMasterData, updateDataMD } from './genericMasterData.js';
import {
  getAddresState,
  getAddressPosition,
  getBirthDateCL,
  setBirthDateCL,
  setBirthDateCLFromBody,
} from './masterdata.js';
import { getDataRamdom, makeClusterAlive } from './misc.js';
import {
  getDataSintegraCPF,
  getDataSintegraRF,
  getDataSintegraSN,
  getDataSintegraST,
} from './sintegra.js';
import { sitemap } from './sitemap.js';
import { CHECKOUT_ROUTES, type CheckoutRouteName } from './manifest.js';

/**
 * Rotas do checkout, sob `/middleware/checkout/*`.
 *
 * O path, o verbo e a visibilidade saem do manifesto; o handler de cada uma
 * esta nos modulos deste diretorio. O mapa abaixo obriga o compilador a cobrir
 * TODAS as rotas do manifesto — rota nova sem handler nao compila.
 */
const HANDLERS: Record<CheckoutRouteName, RequestHandler> = {
  makeClusterAlive,
  getAddressPosition,
  getAddresState,
  getDataSintegraRF,
  getDataSintegraSN,
  getDataSintegraST,
  getDataSintegraCPF,
  getEmployee,
  getDataRamdom,
  getBirthDateCL,
  setBirthDateCL,
  updateDataMD,
  createGiftCard,
  getGiftCardInfoFromMD,
  getDataInMasterData,
  sitemap,
};

export const checkoutRouter: Router = Router();

// O app VTEX IO lia o corpo com `co-body` dentro de cada handler, aceitando
// JSON mesmo sem Content-Type correto. `type: '*/*'` reproduz isso.
const parseBody = express.json({ limit: '1mb', type: '*/*' });

for (const route of CHECKOUT_ROUTES) {
  // Rota publica (o `public: true` do service.json) nao passa pelo auth.
  const chain: RequestHandler[] = route.isPublic ? [] : [requireApiKey];
  const handler = HANDLERS[route.name];

  for (const method of route.methods) {
    switch (method) {
      case 'GET':
        checkoutRouter.get(route.path, ...chain, handler);
        break;
      case 'POST':
        checkoutRouter.post(route.path, ...chain, parseBody, handler);
        break;
      case 'ALL':
        // Rota sem verbo declarado no original: aceita qualquer um, e o corpo
        // e opcional (varias delas leem parametros do corpo mesmo em GET).
        checkoutRouter.all(route.path, ...chain, parseBody, handler);
        break;
    }
  }
}

/**
 * Fora do manifesto de proposito: o `CHECKOUT_ROUTES` e copia fiel do
 * `service.json` do app VTEX IO, e esta rota nao existe la.
 *
 * `POST|PUT /middleware/checkout/setInfo` faz a mesma coisa que
 * `/setInfo/:email/:birthDate`, mas lendo `{ email, birthDate }` do CORPO.
 * Mesmo path base e mesma resposta — migrar o front e trocar so o `fetch`.
 *
 * Nao ha conflito de rota: o Express casa por numero de segmentos, entao
 * `/setInfo` e `/setInfo/:email/:birthDate` sao caminhos distintos.
 */
checkoutRouter.post('/middleware/checkout/setInfo', parseBody, setBirthDateCLFromBody);
checkoutRouter.put('/middleware/checkout/setInfo', parseBody, setBirthDateCLFromBody);

/**
 * Escrita de `customData` do orderForm — tambem fora do manifesto.
 *
 * Ate aqui esse `PUT` saia do navegador; agora e o middleware quem grava.
 * O par app/field vem de `CUSTOM_DATA_FIELDS`, nao de string literal.
 */
checkoutRouter.post(
  '/middleware/checkout/custom-data/birth-date',
  parseBody,
  setBirthDateCustomData,
);

/**
 * Consulta de CNPJ nas quatro fontes, consolidada e ja decidida — sem tocar no
 * orderForm. Use quando so se quer conferir o CNPJ; para conferir E gravar,
 * `corporate-data` faz as duas coisas em uma chamada.
 */
checkoutRouter.post('/middleware/checkout/cnpj/verify', parseBody, verifyCnpjRoute);

/**
 * Fluxo PJ completo: consulta o CNPJ nas quatro fontes e popula o orderForm
 * (perfil corporativo, endereco da Junta Comercial e o payload fiscal do ERP).
 * Substitui o `_handleCNPJSearchBtnClickEv` do `checkout-ui`.
 */
checkoutRouter.post('/middleware/checkout/corporate-data', parseBody, setCorporateData);
// Desistir do CNPJ: mesmo recurso, verbo inverso.
checkoutRouter.delete('/middleware/checkout/corporate-data', parseBody, discardCorporateData);
