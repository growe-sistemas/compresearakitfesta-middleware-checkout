import { z } from 'zod';
import { vtexRequest } from './client.js';

/**
 * Gift Card API (`/api/giftcards`) — porte de `clients/giftCard.ts`.
 *
 * Diferenca em relacao ao app VTEX IO: la o `create` fazia antes um GET em
 * `/api/vtexid/pub/authenticated/user?authToken=<adminUserAuthToken>` so para
 * preencher `profileId`. Fora do VTEX IO nao existe `adminUserAuthToken` (a
 * autenticacao e por AppKey/AppToken, que nao tem usuario associado), entao o
 * `profileId` passou a ser opcional e informado por quem chama.
 */
const giftCardSchema = z
  .object({
    id: z.string(),
    redemptionCode: z.string().optional(),
    redemptionToken: z.string().optional(),
  })
  .passthrough();

export type GiftCard = z.infer<typeof giftCardSchema>;

const transactionSchema = z.unknown();

export interface CreateGiftCardInput {
  relationName: string;
  expiringDate?: string | undefined;
  caption: string;
  currencyCode: string;
  restrictedToOwner: boolean;
  multipleCredits: boolean;
  multipleRedemptions: boolean;
  profileId?: string | undefined;
}

/** `POST /api/giftcards` — cria o gift card. */
export async function createGiftCard(input: CreateGiftCardInput): Promise<GiftCard> {
  return vtexRequest({
    path: '/api/giftcards',
    method: 'POST',
    body: input,
    schema: giftCardSchema,
  });
}

export interface AddBalanceInput {
  /** `Credit` ou `Debit`. */
  operation: string;
  value: number;
  description: string;
  redemptionToken?: string | undefined;
  redemptionCode?: string | undefined;
}

/** `POST /api/giftcards/{id}/transactions` — credita saldo. */
export async function addGiftCardBalance(
  giftCardId: string,
  input: AddBalanceInput,
): Promise<unknown> {
  return vtexRequest({
    path: `/api/giftcards/${giftCardId}/transactions`,
    method: 'POST',
    body: input,
    schema: transactionSchema,
  });
}
