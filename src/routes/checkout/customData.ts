import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../services/vtex/errors.js';
import {
  CUSTOM_DATA_FIELDS,
  orderFormIdSchema,
  putCustomData,
} from '../../services/vtex/checkout.js';
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
