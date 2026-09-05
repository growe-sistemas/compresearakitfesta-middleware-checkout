import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { parseFlexibleDate } from '../../mappers/date.js';
import { findAddressPosition } from '../../mappers/addressPosition.js';
import {
  findAddresses,
  findClient,
  searchDocuments,
  updateDocument,
} from '../../services/vtex/masterdata.js';

const addressPositionBody = z.object({
  userId: z.string().optional(),
  email: z.string().optional(),
  zipCodeCheckout: z.string(),
  numberCheckout: z.string(),
});

/**
 * getAddressPosition — porte de `middlewares/getAddressPosition.ts`.
 *
 * Descobre em que posicao (1-based) da lista de enderecos do cliente esta o
 * endereco do checkout, casando CEP + numero. Sem cliente ou sem match,
 * devolve a proxima posicao livre.
 */
export const getAddressPosition = asyncHandler(async (req, res) => {
  const { userId, email, zipCodeCheckout, numberCheckout } = addressPositionBody.parse(req.body);

  const clients = await findClient({ email, userId, fields: ['id', 'email'] });
  const clientId = clients[0]?.['id'];

  let position = 1;
  if (typeof clientId === 'string' && clientId !== '') {
    const addresses = await findAddresses(clientId);
    position = findAddressPosition(addresses, zipCodeCheckout, numberCheckout);
  }

  res.set('Cache-Control', 'public, max-age=120'); // 2 minutos, como no original
  res.status(200).json({ position });
});

const addresStateBody = z.object({ userId: z.string() });

/**
 * getAddresState — porte de `middlewares/getAddresState.ts`.
 *
 * Devolve os enderecos do cliente, cada um com `userIdCL` anexado. Cliente sem
 * documento CL (convidado) devolve lista vazia — o original ja tratava isso.
 */
export const getAddresState = asyncHandler(async (req, res) => {
  const { userId } = addresStateBody.parse(req.body);

  const clients = await findClient({ userId, fields: ['id', 'email', 'userId'] });
  const client = clients[0];
  const clientId = client?.['id'];

  if (typeof clientId !== 'string' || clientId === '') {
    logger.info({ userId }, 'Nenhum documento CL para o userId; retornando lista vazia');
    res.set('Cache-Control', 'public, max-age=120');
    res.status(200).json([]);
    return;
  }

  const addresses = await findAddresses(clientId);
  const withClientId = addresses.map((address) => ({ ...address, userIdCL: client?.['userId'] }));

  res.set('Cache-Control', 'public, max-age=120');
  res.status(200).json(withClientId);
});

const emailParams = z.object({ email: z.string().min(1) });

/**
 * getBirthDateCL (`/getInfo/:email`) — porte de `middlewares/getBirthDateCL.ts`.
 * Sem documento CL, devolve `birthDate: null` em vez de erro.
 */
export const getBirthDateCL = asyncHandler(async (req, res) => {
  const { email } = emailParams.parse(req.params);

  const documents = await searchDocuments('CL', ['id', 'birthDate'], `email=${email}`, {
    page: 1,
    pageSize: 1,
  });

  const birthDate = documents[0]?.['birthDate'] ?? null;

  res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=120');
  res.status(200).json({ birthDate });
});

/** `dd-MM-yyyy` -> `yyyy-MM-dd` (mesma inversao do app original). */
export function convertDate(dateStr: string, joinStr = '-'): string {
  return dateStr.split('-').reverse().join(joinStr);
}

/**
 * Aceita `dd-MM-yyyy`, `dd/MM/yyyy` ou ISO e entrega sempre `yyyy-MM-dd`.
 * O `refine` antes do `transform` e so para a mensagem de erro sair legivel —
 * `pipe` devolveria "expected string, received null".
 */
const birthDateSchema = z
  .string()
  .min(1)
  .refine((value) => parseFlexibleDate(value) !== null, {
    message: 'birthDate invalida: use dd-MM-yyyy ou yyyy-MM-dd, com data existente',
  })
  .transform((value) => parseFlexibleDate(value) as string);

const setBirthDateParams = z.object({
  email: z.string().min(1),
  birthDate: birthDateSchema,
});

/** Mesma operacao, agora pelo CORPO da requisicao. */
const setBirthDateBody = z.object({
  email: z.string().min(1),
  birthDate: birthDateSchema,
});

/**
 * Grava a data de nascimento na entidade CL.
 *
 * O `email` e reenviado no PATCH de proposito: a entidade CL exige o campo
 * obrigatorio mesmo em atualizacao parcial, senao a VTEX devolve
 * 400 "Required field: 'email'".
 */
async function applyBirthDate(
  email: string,
  isoBirthDate: string,
): Promise<{ updated: boolean; id?: string; reason?: string }> {
  const documents = await searchDocuments('CL', ['id'], `email=${email}`, {
    page: 1,
    pageSize: 1,
  });

  const id = documents[0]?.['id'];

  if (typeof id !== 'string' || id === '') {
    logger.info({ email }, 'Nenhum documento CL para o e-mail');
    return { updated: false, reason: `Nenhum cadastro (CL) encontrado para ${email}` };
  }

  await updateDocument('CL', id, {
    email,
    birthDate: `${isoBirthDate}T00:00:00+00:00`,
  });

  logger.info(
    { email, id, birthDate: isoBirthDate, operation: 'update' },
    'Cliente CL ATUALIZADO: data de nascimento gravada',
  );

  return { updated: true, id };
}

/**
 * setBirthDateCL (`/setInfo/:email/:birthDate`) — porte de
 * `middlewares/setBirthDateCL.ts`.
 *
 * DEPRECADA: dado pessoal em path de URL (vaza para log de proxy, histórico e
 * Referer) e, herdado do VTEX IO, um `GET` que escreve. Use a versao por
 * corpo, `setBirthDateCLFromBody`. Continua no ar so enquanto o `checkout-ui`
 * em producao ainda chamar este formato.
 */
export const setBirthDateCL = asyncHandler(async (req, res) => {
  const { email, birthDate } = setBirthDateParams.parse(req.params);

  logger.warn(
    { email },
    'Uso da rota depreciada /setInfo/:email/:birthDate (dado pessoal em URL)',
  );

  res.status(200).json(await applyBirthDate(email, birthDate));
});

/**
 * `POST|PUT /middleware/checkout/setInfo` — a MESMA operacao, por corpo:
 *
 * ```json
 * { "email": "cliente@dominio.com", "birthDate": "24-11-1995" }
 * ```
 *
 * Substitui `/setInfo/:email/:birthDate`. Ganhos: o e-mail e a data de
 * nascimento saem da URL, o verbo passa a declarar que a chamada escreve, e a
 * data invalida e barrada antes de chegar ao Master Data.
 *
 * A resposta e identica a da rota antiga, para a troca no front ser so o
 * `fetch`.
 */
export const setBirthDateCLFromBody = asyncHandler(async (req, res) => {
  const { email, birthDate } = setBirthDateBody.parse(req.body);

  res.status(200).json(await applyBirthDate(email, birthDate));
});
