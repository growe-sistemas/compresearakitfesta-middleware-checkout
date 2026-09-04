import express, { Router, type RequestHandler } from 'express';
import { getEmployee } from './employee.js';
import { createGiftCard, getGiftCardInfoFromMD } from './giftCard.js';
import { getDataInMasterData, updateDataMD } from './genericMasterData.js';
import {
  getAddresState,
  getAddressPosition,
  getBirthDateCL,
  setBirthDateCL,
} from './masterdata.js';
import { getDataRamdom, makeClusterAlive } from './misc.js';
import {
  getDataSintegraCPF,
  getDataSintegraRF,
  getDataSintegraSN,
  getDataSintegraST,
} from './sintegra.js';
import { sitemap } from './sitemap.js';
import { LEGACY_ROUTES, type LegacyRouteName } from './manifest.js';

/**
 * Rotas portadas do app VTEX IO (`kitfesta-seara/node`).
 *
 * O path e o verbo saem do manifesto (copia fiel do `service.json`); o handler
 * de cada uma esta nos modulos deste diretorio. O mapa abaixo obriga o
 * compilador a cobrir TODAS as rotas do manifesto — rota nova sem handler nao
 * compila.
 */
const HANDLERS: Record<LegacyRouteName, RequestHandler> = {
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

export const legacyRouter: Router = Router();

// O app VTEX IO lia o corpo com `co-body` dentro de cada handler, aceitando
// JSON mesmo sem Content-Type correto. `type: '*/*'` reproduz isso.
const parseBody = express.json({ limit: '1mb', type: '*/*' });

for (const route of LEGACY_ROUTES) {
  const handler = HANDLERS[route.name];

  for (const method of route.methods) {
    switch (method) {
      case 'GET':
        legacyRouter.get(route.path, handler);
        break;
      case 'POST':
        legacyRouter.post(route.path, parseBody, handler);
        break;
      case 'ALL':
        // Rota sem verbo declarado no original: aceita qualquer um, e o corpo
        // e opcional (varias delas leem parametros do corpo mesmo em GET).
        legacyRouter.all(route.path, parseBody, handler);
        break;
    }
  }
}
