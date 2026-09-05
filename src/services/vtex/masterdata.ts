import { z } from 'zod';
import { MASTERDATA_ACCEPT, vtexRequest } from './client.js';

/**
 * Master Data v1 (`/api/dataentities`).
 *
 * Porte de `clients/masterdata.ts` do app VTEX IO. Como o Master Data devolve
 * documentos de schema livre, o schema base e um objeto aberto — o formato de
 * cada entidade (CL, AD, CG, CY) e conhecido so pelo chamador.
 */
export const documentSchema = z.record(z.unknown());
export type MasterDataDocument = z.infer<typeof documentSchema>;

const documentListSchema = z.array(documentSchema);

const createResponseSchema = z.object({
  Id: z.string().optional(),
  Href: z.string().optional(),
  DocumentId: z.string().optional(),
});
export type CreateDocumentResponse = z.infer<typeof createResponseSchema>;

export interface PaginationArgs {
  page: number;
  pageSize: number;
}

/** `page` 1-based vira o header `REST-Range: resources=inicio-fim`. */
function paginationHeader({ page, pageSize }: PaginationArgs): Record<string, string> {
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  return { 'REST-Range': `resources=${startIndex}-${endIndex}` };
}

const baseHeaders: Record<string, string> = { Accept: MASTERDATA_ACCEPT };

/** `GET /{acronym}/search` — equivalente ao `searchDocuments` do app original. */
export async function searchDocuments(
  acronym: string,
  fields: readonly string[],
  where: string,
  pagination: PaginationArgs,
  options?: { sort?: string; schema?: string },
): Promise<MasterDataDocument[]> {
  return vtexRequest({
    path: `/api/dataentities/${acronym}/search`,
    schema: documentListSchema,
    headers: { ...baseHeaders, ...paginationHeader(pagination) },
    query: {
      _fields: fields.join(','),
      _where: where,
      _sort: options?.sort,
      _schema: options?.schema,
    },
  });
}

/**
 * `GET /{acronym}/search?<query crua>` — equivalente ao `searchByCondition`.
 * A condicao ja vem montada como query string (`_fields=a,b&_where=...`),
 * como no app original.
 */
export async function searchByCondition(
  acronym: string,
  conditionQueryString: string,
  restRange?: string,
): Promise<MasterDataDocument[]> {
  return vtexRequest({
    path: `/api/dataentities/${acronym}/search?${conditionQueryString}`,
    schema: documentListSchema,
    headers: restRange !== undefined ? { ...baseHeaders, 'REST-Range': restRange } : baseHeaders,
  });
}

/** `POST /{acronym}/documents` — cria documento. */
export async function createDocument(
  acronym: string,
  fields: Record<string, unknown>,
): Promise<CreateDocumentResponse> {
  return vtexRequest({
    path: `/api/dataentities/${acronym}/documents`,
    method: 'POST',
    body: fields,
    schema: createResponseSchema,
    headers: baseHeaders,
  });
}

/**
 * `PATCH /{acronym}/documents/{id}` — atualizacao parcial.
 * O Master Data responde 204 sem corpo neste endpoint.
 */
export async function updateDocument(
  acronym: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<null> {
  return vtexRequest({
    path: `/api/dataentities/${acronym}/documents/${id}`,
    method: 'PATCH',
    body: fields,
    schema: z.null(),
    headers: baseHeaders,
  });
}

/**
 * Documento CL do cliente, por e-mail ou por `userId` (o `userProfileId` do
 * orderForm). Devolve no maximo um.
 */
export async function findClient(options: {
  email?: string | undefined;
  userId?: string | undefined;
  fields: readonly string[];
}): Promise<MasterDataDocument[]> {
  const where =
    options.email !== undefined ? `email=${options.email}` : `userId=${options.userId ?? ''}`;

  return searchDocuments('CL', options.fields, where, { page: 1, pageSize: 1 });
}

/**
 * Enderecos (entidade AD) do cliente, na ordem de criacao.
 *
 * ATENCAO: o campo `userId` da AD NAO e o `userProfileId` do orderForm — e o
 * **id do documento CL**. A cadeia e sempre `email (ou userId) -> CL.id ->
 * AD.userId`.
 *
 * A ordem (`createdIn ASC`) e o que define a posicao usada como
 * `current_address_id` no ERP: mudar isso muda o dado que o ERP recebe.
 */
export async function findAddresses(clientId: string): Promise<MasterDataDocument[]> {
  return vtexRequest({
    path: '/api/dataentities/AD/search',
    schema: documentListSchema,
    headers: { ...baseHeaders, 'REST-Range': 'resources=0-100' },
    query: { _where: `userId=${clientId}`, _fields: '_all', _sort: 'createdIn ASC' },
  });
}
