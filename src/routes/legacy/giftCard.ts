import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { generateGiftCardCodes } from '../../mappers/giftCardCodes.js';
import { createGiftCard as createGiftCardApi, addGiftCardBalance } from '../../services/vtex/giftcard.js';
import { createDocument, searchDocuments } from '../../services/vtex/masterdata.js';
import { AppError } from '../../services/vtex/errors.js';

/**
 * createGiftCard — porte da cadeia
 * `generateUniqueGiftCardInfos` -> `createGiftCard` -> `addGiftCardBalance`.
 *
 * No VTEX IO eram 3 middlewares encadeados passando dados por `ctx.body`.
 * Aqui viraram 3 etapas de uma funcao, porque `ctx.body` como canal entre
 * middlewares nao tem equivalente limpo no Express — e o resultado
 * intermediario nunca deveria ter sido a resposta.
 *
 * Uma correcao obrigatoria: o original tinha um LOOP INFINITO. Ele fazia
 *   `while (mdResult[index].length > 0) { regenera os codigos }`
 * sem reconsultar o Master Data, entao a condicao nunca mudava — qualquer
 * colisao de codigo pendurava o worker. Aqui a busca e refeita a cada
 * tentativa, com limite.
 */

const MAX_CODE_ATTEMPTS = 10;
const MAX_QUANTITY = 100;

const createBody = z.object({
  prefix: z.string().min(1),
  value: z.number(),
  expiringDate: z.string().optional(),
  quantity: z.number().int().positive().max(MAX_QUANTITY),
});

/** Sorteia codigos ate achar um par que ainda nao existe na entidade CG. */
async function generateUniqueCodes(prefix: string): Promise<{
  relationName: string;
  customCode: string;
}> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const codes = generateGiftCardCodes(prefix);

    const existing = await searchDocuments(
      'CG',
      ['codigoCupom', 'codigoCustomizado', 'relationName'],
      `relationName=${codes.relationName} OR codigoCustomizado=${codes.customCode}`,
      { page: 1, pageSize: 25 },
    );

    if (existing.length === 0) return codes;

    logger.warn({ attempt: attempt + 1, prefix }, 'Colisao de codigo de gift card, sorteando outro');
  }

  throw new AppError(
    503,
    'GIFTCARD_CODE_COLLISION',
    `Nao foi possivel gerar um codigo livre para o prefixo ${prefix} em ${MAX_CODE_ATTEMPTS} tentativas`,
  );
}

export const createGiftCard = asyncHandler(async (req, res) => {
  const { prefix, value, expiringDate, quantity } = createBody.parse(req.body);

  const created: Array<{
    id: string;
    redemptionCode: string | undefined;
    codigoCustomizado: string;
    relationName: string;
    value: number;
  }> = [];

  for (let index = 0; index < quantity; index += 1) {
    const { relationName, customCode } = await generateUniqueCodes(prefix);

    // 1) cria o gift card
    const giftCard = await createGiftCardApi({
      relationName,
      expiringDate,
      caption: relationName,
      currencyCode: 'BRL',
      restrictedToOwner: false,
      multipleCredits: true,
      multipleRedemptions: false,
    });

    // 2) registra o de/para do codigo na entidade CG
    await createDocument('CG', {
      codigoCustomizado: customCode,
      relationName,
      codigoCupom: giftCard.redemptionCode,
      giftCardId: giftCard.id,
    });

    // 3) credita o saldo
    await addGiftCardBalance(giftCard.id, {
      operation: 'Credit',
      value,
      description: 'test', // string do original, preservada
      redemptionToken: giftCard.redemptionToken,
      redemptionCode: giftCard.redemptionCode,
    });

    created.push({
      id: giftCard.id,
      redemptionCode: giftCard.redemptionCode,
      codigoCustomizado: customCode,
      relationName,
      value,
    });
  }

  res.status(200).json(created);
});

const giftCardInfoBody = z.object({ codigoCustomizado: z.string().min(1) });

/** getGiftCardInfoFromMD — porte de `middlewares/getGiftInfoFromMD.ts`. */
export const getGiftCardInfoFromMD = asyncHandler(async (req, res) => {
  const { codigoCustomizado } = giftCardInfoBody.parse(req.body);

  const documents = await searchDocuments(
    'CG',
    ['codigoCustomizado', 'codigoCupom'],
    `codigoCustomizado=${codigoCustomizado}`,
    { page: 1, pageSize: 25 },
  );

  res.status(200).json(documents);
});
