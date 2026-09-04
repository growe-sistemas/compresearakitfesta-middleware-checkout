import { z } from 'zod';
import { vtexRequest } from './client.js';

/**
 * Catalog System — porte de `clients/catalog.ts`.
 *
 * So os campos que o sitemap usa sao validados; o resto do produto passa
 * livre (`passthrough`) para nao quebrar quando a VTEX adiciona campo.
 */
const commertialOfferSchema = z
  .object({
    Price: z.number().nullable().optional(),
  })
  .passthrough();

const sellerSchema = z
  .object({
    commertialOffer: commertialOfferSchema.optional(),
  })
  .passthrough();

const itemSchema = z
  .object({
    sellers: z.array(sellerSchema).optional(),
  })
  .passthrough();

const searchProductSchema = z
  .object({
    productId: z.string().optional(),
    productName: z.string().optional(),
    linkText: z.string().optional(),
    items: z.array(itemSchema).optional(),
  })
  .passthrough();

export type SearchProduct = z.infer<typeof searchProductSchema>;

const searchProductListSchema = z.array(searchProductSchema);

/**
 * `GET /api/catalog_system/pub/products/search?_from&_to`.
 * Os defaults (1..50) sao os mesmos do app original.
 */
export async function getSearchProducts(from = 1, to = 50): Promise<SearchProduct[]> {
  return vtexRequest({
    path: '/api/catalog_system/pub/products/search',
    schema: searchProductListSchema,
    query: { _from: from, _to: to },
  });
}
