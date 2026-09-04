import type { MasterDataDocument } from '../services/vtex/masterdata.js';
import type { SearchProduct } from '../services/vtex/catalog.js';

/** Escapa texto antes de entrar no XML. */
export function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function text(value: unknown): string {
  if (typeof value === 'string') return escapeXml(value);
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Sitemap de produtos.
 *
 * Mantem a estrutura nao-padrao do app original (tags `productId`,
 * `productName`, `price` e um `<url>` aninhado dentro de `<url>`) — mexer nisso
 * mudaria o contrato de quem ja consome. Diferenca: os valores agora sao
 * escapados, e produto sem seller/preco nao derruba a geracao.
 */
export function buildProductsSitemap(products: readonly SearchProduct[], baseUrl: string): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const product of products.slice(0, 100)) {
    const price = product.items?.[0]?.sellers?.[0]?.commertialOffer?.Price;

    xml += '  <url>\n';
    xml += `    <url>${baseUrl}/${text(product.linkText)}/p</url>\n`;
    xml += `    <productId>${text(product.productId)}</productId>\n`;
    xml += `    <productName>${text(product.productName)}</productName>\n`;
    xml += `    <price>${price ?? ''}</price>\n`;
    xml += '  </url>\n';
  }

  xml += '</urlset>';
  return xml;
}

/** Sitemap de posts (entidade CY do Master Data). */
export function buildPostsSitemap(posts: readonly MasterDataDocument[], baseUrl: string): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const post of posts) {
    const rawLink = post['link'];
    const slug = post['slug'];
    const link =
      typeof rawLink === 'string' && rawLink !== ''
        ? rawLink
        : typeof slug === 'string' && slug !== ''
          ? `/blog/${slug}`
          : '';

    // Post sem link nem slug nao vira URL — mesmo comportamento do original.
    if (link === '') continue;

    const loc = /^https?:\/\//i.test(link) ? link : `${baseUrl}${link}`;

    const rawDate = post['updated_at'] ?? post['created_at'];
    const parsedDate = typeof rawDate === 'string' ? new Date(rawDate) : new Date();
    const lastmod = Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString();

    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(loc)}</loc>\n`;
    xml += `    <lastmod>${lastmod}</lastmod>\n`;
    xml += `    <category_name>${text(post['category_name'])}</category_name>\n`;
    xml += `    <category_slug>${text(post['category_slug'])}</category_slug>\n`;
    xml += `    <title>${text(post['title'])}</title>\n`;
    xml += `    <author>${text(post['author'])}</author>\n`;
    xml += '  </url>\n';
  }

  xml += '</urlset>';
  return xml;
}

/** Indice apontando para os dois sitemaps acima. */
export function buildIndexSitemap(baseUrl: string): string {
  const now = new Date().toISOString();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const type of ['products', 'posts']) {
    xml += '  <sitemap>\n';
    xml += `    <loc>${baseUrl}/_v/sitemap/${type}</loc>\n`;
    xml += `    <lastmod>${now}</lastmod>\n`;
    xml += '  </sitemap>\n';
  }

  xml += '</sitemapindex>';
  return xml;
}
