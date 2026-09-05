import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { env } from '../../config/env.js';
import {
  buildIndexSitemap,
  buildPostsSitemap,
  buildProductsSitemap,
} from '../../mappers/sitemap.js';
import { getSearchProducts } from '../../services/vtex/catalog.js';
import { searchByCondition } from '../../services/vtex/masterdata.js';

/** Campos do post (entidade CY) usados no sitemap, como no app original. */
const POST_FIELDS = [
  'slug',
  'link',
  'title',
  'created_at',
  'updated_at',
  'category_name',
  'category_slug',
  'author',
] as const;

const typeParams = z.object({ type: z.string().optional() });

/**
 * sitemap (`/middleware/checkout/sitemap/:type?`, era `/_v/sitemap/:type?`) —
 * porte de `middlewares/sitemap.ts`.
 *
 * `products` e `posts` geram o urlset correspondente; qualquer outro valor
 * (inclusive ausente) devolve o indice.
 */
export const sitemap = asyncHandler(async (req, res) => {
  const { type: rawType } = typeParams.parse(req.params);
  const type = (rawType ?? 'index').trim().toLowerCase();

  // No app VTEX IO a base era sempre `<account>.myvtex.com`.
  const baseUrl = `https://${env.VTEX_ACCOUNT}.myvtex.com`;

  let xml: string;

  switch (type) {
    case 'products': {
      // Duas paginas de 50, como no original (limite de 100 no urlset).
      const [first, second] = await Promise.all([
        getSearchProducts(1, 50),
        getSearchProducts(51, 100),
      ]);
      xml = buildProductsSitemap([...first, ...second], baseUrl);
      break;
    }
    case 'posts': {
      const posts = await searchByCondition(
        'CY',
        `_fields=${POST_FIELDS.join(',')}`,
        'resources=0-1000',
      );
      xml = buildPostsSitemap(posts, baseUrl);
      break;
    }
    default:
      xml = buildIndexSitemap(baseUrl);
  }

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.status(200).send(xml);
});
