import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../services/vtex/errors.js';
import {
  CUSTOM_DATA_FIELDS,
  orderFormIdSchema,
  putCustomData,
} from '../../services/vtex/checkout.js';
import { normalizeBirthDate } from './masterdata.js';

/**
 * Escrita de `customData` do orderForm pelo middleware.
 *
 * Ate aqui, quem gravava `custom_birth_date` era o proprio navegador
 * (`checkout-ui/.../controller.js:1302`), montando o corpo, escolhendo o
 * formato da data e conferindo a gravacao por conta propria. Esta rota move
 * essa responsabilidade para o servidor.
 */

/** `yyyy-MM-dd` -> `dd/mm/yyyy`, o formato que o campo guarda hoje. */
function toStoredFormat(isoDate: string): string {
  const [year, month, day] = isoDate.split('-') as [string, string, string];
  return `${day}/${month}/${year}`;
}

const birthDateBody = z.object({
  orderFormId: orderFormIdSchema,
  /**
   * Aceita `dd-MM-yyyy` (o que o `checkout-ui` ja monta) ou ISO `yyyy-MM-dd`.
   * Data que nao existe no calendario e barrada aqui, antes da VTEX.
   */
  birthDate: z
    .string()
    .min(1)
    .refine((value) => normalizeBirthDate(value) !== null, {
      message: 'birthDate invalida: use dd-MM-yyyy ou yyyy-MM-dd, com data existente',
    })
    .transform((value) => normalizeBirthDate(value) as string),
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
  const value = toStoredFormat(birthDate);

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
