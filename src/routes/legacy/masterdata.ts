import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { findAddressPosition } from '../../mappers/addressPosition.js';
import {
  searchDocuments,
  updateDocument,
  type MasterDataDocument,
} from '../../services/vtex/masterdata.js';
import { vtexRequest } from '../../services/vtex/client.js';
import { MASTERDATA_ACCEPT } from '../../services/vtex/client.js';

const documentListSchema = z.array(z.record(z.unknown()));

/** Busca o documento CL por email ou userId, como no app original. */
async function findClient(options: {
  email?: string | undefined;
  userId?: string | undefined;
  fields: readonly string[];
}): Promise<MasterDataDocument[]> {
  const where =
    options.email !== undefined ? `email=${options.email}` : `userId=${options.userId ?? ''}`;

  return searchDocuments('CL', options.fields, where, { page: 1, pageSize: 1 });
}

/** Enderecos (AD) do cliente, ordenados por `createdIn ASC`. */
async function findAddresses(clientId: string): Promise<MasterDataDocument[]> {
  return vtexRequest({
    path: '/api/dataentities/AD/search',
    schema: documentListSchema,
    headers: { Accept: MASTERDATA_ACCEPT, 'REST-Range': 'resources=0-100' },
    query: { _where: `userId=${clientId}`, _fields: '_all', _sort: 'createdIn ASC' },
  });
}

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

const setBirthDateParams = z.object({
  email: z.string().min(1),
  birthDate: z.string().min(1),
});

/**
 * setBirthDateCL (`/setInfo/:email/:birthDate`) — porte de
 * `middlewares/setBirthDateCL.ts`.
 *
 * O `email` e reenviado no PATCH de proposito: a entidade CL exige o campo
 * obrigatorio mesmo em atualizacao parcial, senao a VTEX devolve
 * 400 "Required field: 'email'".
 */
export const setBirthDateCL = asyncHandler(async (req, res) => {
  const { email, birthDate } = setBirthDateParams.parse(req.params);

  const documents = await searchDocuments('CL', ['id'], `email=${email}`, {
    page: 1,
    pageSize: 1,
  });

  const id = documents[0]?.['id'];

  if (typeof id !== 'string' || id === '') {
    logger.info({ email }, 'Nenhum documento CL para o e-mail');
    res.status(200).json({
      updated: false,
      reason: `Nenhum cadastro (CL) encontrado para ${email}`,
    });
    return;
  }

  await updateDocument('CL', id, {
    email,
    birthDate: `${convertDate(birthDate)}T00:00:00+00:00`,
  });

  res.status(200).json({ updated: true, id });
});
