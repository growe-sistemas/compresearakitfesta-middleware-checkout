import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../services/vtex/errors.js';
import {
  CUSTOM_DATA_FIELDS,
  getOrderForm,
  orderFormIdSchema,
  putCustomData,
  type OrderFormResponse,
} from '../../services/vtex/checkout.js';
import { findAddresses, findClient } from '../../services/vtex/masterdata.js';
import { findAddressPosition } from '../../mappers/addressPosition.js';
import { isValidCnpj, verifyCnpj } from '../../mappers/cnpj.js';
import { isMasked } from '../../mappers/corporateProfile.js';
import { fetchCnpjSources } from '../../services/documents/cnpjSources.js';
import { parseFlexibleDate, toBrazilianDate } from '../../mappers/date.js';

/**
 * Escrita de `customData` do orderForm pelo middleware.
 *
 * Ate aqui, quem gravava `custom_birth_date` era o proprio navegador
 * (`checkout-ui/.../controller.js:1302`), montando o corpo, escolhendo o
 * formato da data e conferindo a gravacao por conta propria. Esta rota move
 * essa responsabilidade para o servidor.
 */

/**
 * Campo de data do corpo: aceita `dd-MM-yyyy`, `dd/MM/yyyy`, ISO `YYYY-MM-DD`
 * e data-e-hora ISO; entrega sempre `YYYY-MM-DD`.
 *
 * O `refine` antes do `transform` e so para a mensagem sair legivel: `pipe`
 * devolveria "expected string, received null".
 */
function dateField(nome: string) {
  return z
    .string()
    .min(1)
    .refine((value) => parseFlexibleDate(value) !== null, {
      message: `${nome} invalida: use dd-MM-yyyy, dd/MM/yyyy ou YYYY-MM-DD, com data existente`,
    })
    .transform((value) => parseFlexibleDate(value) as string);
}

/**
 * Endereco escolhido no checkout. Le `selectedAddresses[0]`, de onde o
 * `SetAddress` do `checkout-ui` tira CEP e numero.
 */
function readSelectedAddress(
  orderForm: OrderFormResponse,
): { postalCode: string; number: string } | null {
  const shipping = (orderForm as Record<string, unknown> | null)?.['shippingData'];
  if (typeof shipping !== 'object' || shipping === null) return null;

  const selected = (shipping as Record<string, unknown>)['selectedAddresses'];
  if (!Array.isArray(selected) || selected.length === 0) return null;

  const first: unknown = selected[0];
  if (typeof first !== 'object' || first === null) return null;

  const address = first as Record<string, unknown>;
  const postalCode = typeof address['postalCode'] === 'string' ? address['postalCode'] : '';
  const number = typeof address['number'] === 'string' ? address['number'] : '';

  return postalCode === '' ? null : { postalCode, number };
}

const birthDateBody = z.object({
  orderFormId: orderFormIdSchema,
  /** Data que nao existe no calendario e barrada aqui, antes da VTEX. */
  birthDate: dateField('birthDate'),
});

/**
 * `POST /middleware/checkout/custom-data/birth-date`
 *
 * ```json
 * { "orderFormId": "abc123…", "birthDate": "24-11-1995" }
 * ```
 *
 * Grava `customData.custom_birth_date` no orderForm da VTEX e **confere** a
 * gravacao na propria resposta, sem requisicao extra.
 *
 * O formato de armazenamento (`dd/mm/yyyy`) e o mesmo de hoje — o ERP nao
 * percebe diferenca. O que muda e onde a conversao acontece: aqui, uma vez,
 * em vez de espalhada no front.
 *
 * Publica, como o resto da familia `/middleware/checkout/*`: quem chama e o
 * checkout, do navegador. O `orderFormId` e a credencial da operacao.
 */
export const setBirthDateCustomData = asyncHandler(async (req, res) => {
  const { orderFormId, birthDate } = birthDateBody.parse(req.body);

  const { app, field } = CUSTOM_DATA_FIELDS.birthDate;
  const value = toBrazilianDate(birthDate) as string;

  const result = await putCustomData({ orderFormId, app, field, value });

  // A VTEX aceitou (2xx) e devolveu o orderForm, mas com outro valor no campo.
  // Nao da para responder "gravado": isso significaria o pedido seguir sem a
  // data de nascimento e ninguem perceber — o cenario que o guarda do botao
  // finalizar existe para evitar no front.
  if (result.storedValue !== null && !result.confirmed) {
    throw new AppError(
      502,
      'CUSTOM_DATA_NOT_PERSISTED',
      `A VTEX aceitou a gravacao de ${field} mas devolveu "${result.storedValue}" em vez de "${value}"`,
    );
  }

  logger.info(
    { orderFormId, field, value, confirmed: result.confirmed },
    'customData gravado no orderForm',
  );

  res.status(200).json({
    updated: true, // chegou aqui = a VTEX aceitou e nada divergiu
    orderFormId: result.orderFormId ?? orderFormId,
    field,
    /** Como ficou gravado, no formato do campo. */
    value,
    /** ISO, para quem preferir trabalhar com data normalizada. */
    birthDate,
    /** `true` = a resposta da VTEX ja trouxe o valor gravado e ele confere. */
    confirmed: result.confirmed,
    storedValue: result.storedValue,
  });
});

const deliveryDateBody = z.object({
  orderFormId: orderFormIdSchema,
  /**
   * Data da entrega escolhida. Alem dos formatos de data, aceita data-e-hora
   * ISO — para o front poder mandar direto o
   * `shippingData.logisticsInfo[0].slas[0].deliveryWindow.endDateUtc`, sem
   * converter nada antes.
   */
  deliveryDate: dateField('deliveryDate'),
});

/**
 * `POST /middleware/checkout/custom-data/delivery-date`
 *
 * Grava a data de entrega escolhida em `customData.custom_delivery_date`.
 *
 * Substitui o `setScheduleDateCheckout` do `checkout-ui`
 * (`components/Schedule/index.js:73`), que montava o corpo, convertia a data
 * no fuso do NAVEGADOR e nao conferia a gravacao.
 *
 * ---------------------------------------------------------------------------
 * REQUEST
 * ---------------------------------------------------------------------------
 * ```json
 * { "orderFormId": "cc551425e8a445878344b79b79c48f6d", "deliveryDate": "27-11-2026" }
 * ```
 * `deliveryDate` aceita `dd-MM-yyyy`, `dd/MM/yyyy`, `YYYY-MM-DD` ou data-e-hora
 * ISO (`2026-11-27T12:00:00Z`).
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "updated": true,
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "field": "custom_delivery_date",
 *   "value": "27/11/2026",
 *   "deliveryDate": "2026-11-27",
 *   "confirmed": true,
 *   "storedValue": "27/11/2026"
 * }
 * ```
 *
 * ERROS
 * - `400 VALIDATION_ERROR`          data inexistente, formato desconhecido ou
 *                                   `orderFormId` fora do padrao
 * - `502 CUSTOM_DATA_NOT_PERSISTED` a VTEX aceitou mas gravou outro valor
 *
 * ATENCAO AO FUSO: data-e-hora e convertida no calendario de **Sao Paulo**,
 * nao em UTC. Uma janela de entrega em `2026-11-27T00:00:00Z` vira
 * `26/11/2026` — que e o dia que o cliente brasileiro ve. O front fazia o
 * mesmo por acidente (usava o fuso do navegador); aqui a regra e explicita.
 */
export const setDeliveryDateCustomData = asyncHandler(async (req, res) => {
  const { orderFormId, deliveryDate } = deliveryDateBody.parse(req.body);

  const { app, field } = CUSTOM_DATA_FIELDS.deliveryDate;
  const value = toBrazilianDate(deliveryDate) as string;

  const result = await putCustomData({ orderFormId, app, field, value });

  if (result.storedValue !== null && !result.confirmed) {
    throw new AppError(
      502,
      'CUSTOM_DATA_NOT_PERSISTED',
      `A VTEX aceitou a gravacao de ${field} mas devolveu "${result.storedValue}" em vez de "${value}"`,
    );
  }

  logger.info(
    { orderFormId, field, value, confirmed: result.confirmed },
    'customData gravado no orderForm',
  );

  res.status(200).json({
    updated: true,
    orderFormId: result.orderFormId ?? orderFormId,
    field,
    value,
    deliveryDate,
    confirmed: result.confirmed,
    storedValue: result.storedValue,
  });
});

const erpAddressIdBody = z.object({ orderFormId: orderFormIdSchema });

/**
 * `POST /middleware/checkout/custom-data/erp-address-id`
 *
 * Descobre a posicao do endereco de entrega na lista do cliente e grava em
 * `customData.current_address_id`. E o numero que o ERP usa para saber QUAL
 * dos enderecos cadastrados e o da entrega.
 *
 * Faz sozinha o que hoje sao duas etapas separadas no `checkout-ui`
 * (`SetAddress/index.js`): consultar a posicao e gravar o campo. Nao ha chamada
 * HTTP entre elas — as buscas de CL e AD e o calculo da posicao rodam aqui
 * dentro.
 *
 * ---------------------------------------------------------------------------
 * REQUEST
 * ---------------------------------------------------------------------------
 * ```json
 * { "orderFormId": "cc551425e8a445878344b79b79c48f6d" }
 * ```
 * So o `orderFormId`: o e-mail e o endereco selecionado saem do proprio
 * orderForm, entao nao ha como o chamador mandar endereco desatualizado.
 *
 * ---------------------------------------------------------------------------
 * FLUXO
 * ---------------------------------------------------------------------------
 * 1. Le o orderForm.
 * 2. **PJ** -> posicao `1`, sem consultar a AD. O endereco da PJ vem da Junta
 *    Comercial e nao esta na lista do cliente; e o valor que o ERP ja recebe.
 * 3. **PF** -> `clientProfileData.email` -> documento CL -> enderecos AD
 *    (`_sort=createdIn ASC`) -> posicao 1-based do que casa CEP + numero de
 *    `shippingData.selectedAddresses[0]`.
 * 4. Grava `current_address_id` como STRING e confere a gravacao.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "updated": true,
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "field": "current_address_id",
 *   "value": "1",
 *   "position": 1,
 *   "matched": true,
 *   "addressCount": 3,
 *   "isCorporate": false,
 *   "confirmed": true,
 *   "storedValue": "1"
 * }
 * ```
 * `position`, `matched` e `addressCount` vao junto porque sem eles nao da para
 * saber se a posicao veio de um endereco que casou ou do fallback.
 *
 * CASOS DE BORDA (herdados do `getAddressPosition`, preservados):
 * - casou CEP + numero       -> indice + 1
 * - nao casou nenhum         -> `length + 1` (proxima posicao livre)
 * - cliente sem documento CL -> `1`
 * - PJ                       -> `1`
 *
 * ERROS
 * - `400 VALIDATION_ERROR`          `orderFormId` fora do formato
 * - `400 MISSING_SELECTED_ADDRESS`  PF sem endereco escolhido no orderForm.
 *                                   Chamar antes da escolha e erro de quem
 *                                   chama; inventar posicao seria pior.
 * - `502 CUSTOM_DATA_NOT_PERSISTED` a VTEX aceitou mas gravou outro valor
 */
export const setErpAddressIdCustomData = asyncHandler(async (req, res) => {
  const { orderFormId } = erpAddressIdBody.parse(req.body);

  const orderForm = await getOrderForm(orderFormId);
  const profile = orderForm?.clientProfileData ?? null;
  const isCorporate = profile?.['isCorporate'] === true;

  let position = 1;
  let matched = false;
  let addressCount = 0;

  if (!isCorporate) {
    const selected = readSelectedAddress(orderForm);
    if (selected === null) {
      throw new AppError(
        400,
        'MISSING_SELECTED_ADDRESS',
        'O orderForm ainda nao tem endereco selecionado: nao ha o que posicionar na lista do cliente',
      );
    }

    // E-mail mascarado (comprador nao autenticado) nao serve de chave: buscar
    // a CL por `"G***@..."` nao acha nada e a posicao cairia em 1 em silencio.
    const rawEmail = profile?.['email'];
    const email =
      typeof rawEmail === 'string' && rawEmail !== '' && !isMasked(rawEmail) ? rawEmail : undefined;

    // Sem e-mail nao ha como chegar ao documento CL, e sem CL nao ha lista de
    // enderecos. Cliente convidado cai aqui e fica com a posicao 1 — mesmo
    // comportamento do `getAddressPosition`.
    if (email !== undefined && email !== '') {
      const clients = await findClient({ email, fields: ['id', 'email'] });
      const clientId = clients[0]?.['id'];

      if (typeof clientId === 'string' && clientId !== '') {
        // `userId` da AD e o id do documento CL, nao o userProfileId.
        const addresses = await findAddresses(clientId);
        addressCount = addresses.length;
        position = findAddressPosition(addresses, selected.postalCode, selected.number);
        matched = position <= addresses.length;
      }
    }
  }

  const { app, field } = CUSTOM_DATA_FIELDS.addressId;
  // String de proposito: campo de customData na VTEX e texto. O `checkout-ui`
  // mandava numero e deixava a VTEX coagir.
  const value = String(position);

  const result = await putCustomData({ orderFormId, app, field, value });

  if (result.storedValue !== null && !result.confirmed) {
    throw new AppError(
      502,
      'CUSTOM_DATA_NOT_PERSISTED',
      `A VTEX aceitou a gravacao de ${field} mas devolveu "${result.storedValue}" em vez de "${value}"`,
    );
  }

  logger.info(
    { orderFormId, field, value, position, matched, addressCount, isCorporate },
    'customData gravado no orderForm',
  );

  res.status(200).json({
    updated: true,
    orderFormId: result.orderFormId ?? orderFormId,
    field,
    value,
    position,
    matched,
    addressCount,
    isCorporate,
    confirmed: result.confirmed,
    storedValue: result.storedValue,
  });
});

const cnpjCustomDataBody = z.object({
  orderFormId: orderFormIdSchema,
  cnpj: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 14, 'CNPJ deve ter 14 digitos')
    .refine(isValidCnpj, 'CNPJ invalido'),
  /**
   * E-mail do cliente para o `DS_EMAIL_NFD`, quando a empresa nao tem e-mail
   * proprio nas fontes. Mandando, a rota poupa a leitura do orderForm.
   */
  fallbackEmail: z.string().email().optional(),
});

/**
 * `POST /middleware/checkout/custom-data/cnpj`
 *
 * Consulta o CNPJ e grava **apenas** `customData.custom_cnpj_data`.
 *
 * Diferenca para o `corporate-data`: esta rota **nao toca no `shippingData`**
 * — nao limpa e nao atualiza — nem no `clientProfileData`. O orderForm sai
 * intacto fora desse campo. Serve para o caso em que o endereco de entrega
 * ja esta definido e nao pode ser substituido pelo da Junta Comercial.
 *
 * O caminho da consulta e o MESMO do `corporate-data`, com as tres camadas:
 * memoria -> Master Data `CB` -> SintegraWS + publica.cnpj.ws. Ou seja, um
 * CNPJ ja conhecido responde em ~1s em vez de ate 26s, e sem gastar cota.
 *
 * ---------------------------------------------------------------------------
 * REQUEST
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "cnpj": "50.972.373/0001-00",
 *   "fallbackEmail": "cliente@dominio.com"
 * }
 * ```
 * `fallbackEmail` e opcional: sem ele, a rota le o e-mail do proprio orderForm.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200 — gravado
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "updated": true,
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "field": "custom_cnpj_data",
 *   "value": "{\"DS_EMAIL_NFD\":\"contato@groweag.com\",...}",
 *   "confirmed": true,
 *   "storedValue": "{...}",
 *   "verification": { "...as quatro fontes consolidadas..." },
 *   "sources": { "RF": "ok", "SN": "ok", "ST": "not_found", "PUBLICA": "ok" },
 *   "cache": { "hit": true, "source": "masterdata", "ageSeconds": 45 },
 *   "durationMs": 1029
 * }
 * ```
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200 — CNPJ reprovado, NADA gravado
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "updated": false,
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "field": "custom_cnpj_data",
 *   "verification": { "approved": false, "reason": "...", "message": "..." },
 *   "sources": {}, "cache": {}, "durationMs": 0
 * }
 * ```
 * Os `reason` sao os mesmos do `corporate-data`: `DOCUMENT_NOT_FOUND`,
 * `SOURCES_UNAVAILABLE`, `REGISTRATION_INACTIVE`, `INCOMPLETE_FISCAL_DATA` e
 * `MISSING_POSTAL_CODE`.
 *
 * ERROS
 * - `400 VALIDATION_ERROR`          CNPJ ou `orderFormId` fora do formato
 *                                   (digito verificador conferido antes de
 *                                   gastar consulta paga)
 * - `502 CUSTOM_DATA_NOT_PERSISTED` a VTEX aceitou mas gravou outro valor
 */
export const setCnpjCustomData = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { orderFormId, cnpj, fallbackEmail } = cnpjCustomDataBody.parse(req.body);

  const { sources, statuses, cache } = await fetchCnpjSources(cnpj);

  // So le o orderForm quando precisa do e-mail — e uma requisicao a menos
  // quando o chamador ja informou. Leitura nao altera nada.
  let email = fallbackEmail;
  if (email === undefined) {
    const orderForm = await getOrderForm(orderFormId);
    const current = orderForm?.clientProfileData?.['email'];
    // Mascarado vale como ausente: `DS_EMAIL_NFD` com `"g***@..."` chegaria
    // ao ERP como se fosse o e-mail de verdade.
    if (typeof current === 'string' && current !== '' && !isMasked(current)) email = current;
  }

  const verification = verifyCnpj({ cnpj, sources, statuses, fallbackEmail: email });

  const { app, field } = CUSTOM_DATA_FIELDS.cnpjData;

  // CNPJ reprovado nao grava: o ERP receber payload fiscal de empresa baixada
  // seria pior que nao receber nada.
  if (!verification.approved) {
    logger.info(
      { orderFormId, cnpj, reason: verification.reason, sources: statuses },
      'CNPJ reprovado; customData intacto',
    );

    res.status(200).json({
      updated: false,
      orderFormId,
      field,
      verification,
      sources: statuses,
      cache,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  // Campo de customData e texto: o objeto vai serializado, como o ERP ja recebe.
  const value = JSON.stringify(verification.erpCustomData);
  const result = await putCustomData({ orderFormId, app, field, value });

  if (result.storedValue !== null && !result.confirmed) {
    throw new AppError(
      502,
      'CUSTOM_DATA_NOT_PERSISTED',
      `A VTEX aceitou a gravacao de ${field} mas devolveu outro valor`,
    );
  }

  const durationMs = Date.now() - startedAt;

  logger.info(
    {
      orderFormId,
      cnpj,
      field,
      confirmed: result.confirmed,
      cacheHit: cache.hit,
      cacheSource: cache.source,
      durationMs,
    },
    'custom_cnpj_data gravado sem tocar em shippingData',
  );

  res.status(200).json({
    updated: true,
    orderFormId: result.orderFormId ?? orderFormId,
    field,
    value,
    confirmed: result.confirmed,
    storedValue: result.storedValue,
    verification,
    sources: statuses,
    cache,
    durationMs,
  });
});
