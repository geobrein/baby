/** Zoeken in een webwinkel en de prijs van een productpagina lezen. */
import { extractLinks, stripTags, decodeEntities } from './html.mjs';
import { extractProduct, unitPrice } from './parse.mjs';
import { bestCandidate, scoreCandidate } from './match.mjs';

/** Zet een slug om in een leesbare titel: "pampers-baby-dry-maat-4" -> "pampers baby dry maat 4". */
export function titleFromUrl(url) {
  try {
    const { pathname } = new URL(url, 'https://example.com');
    const parts = pathname.split('/').filter(Boolean);
    const slug = parts.filter((p) => !/^\d+$/.test(p) && p !== 'p').pop() ?? '';
    return slug.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** Haalt kandidaat-producten (titel + URL) uit een zoekresultatenpagina. */
export function extractCandidates(html, shop, baseUrl) {
  const pathPattern = shop.productPathPattern ? new RegExp(shop.productPathPattern) : null;
  const found = new Map();

  const anchorRe = /<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]{0,600}?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    addCandidate(found, m[2], stripTags(m[4]), shop, baseUrl, pathPattern, m[1] + m[3]);
  }
  // Terugval: winkels die hun resultaten met JS renderen laten vaak wel kale hrefs achter.
  if (found.size === 0) {
    for (const href of extractLinks(html)) addCandidate(found, href, '', shop, baseUrl, pathPattern, '');
  }
  return [...found.values()];
}

function addCandidate(found, href, anchorText, shop, baseUrl, pathPattern, attrs) {
  let abs;
  try {
    abs = new URL(decodeEntities(href), baseUrl ?? shop.site);
  } catch {
    return;
  }
  if (!/^https?:$/.test(abs.protocol)) return;
  if (new URL(shop.site).host.replace(/^www\./, '') !== abs.host.replace(/^www\./, '')) return;
  if (pathPattern && !pathPattern.test(abs.pathname)) return;

  abs.hash = '';
  abs.search = '';
  const key = abs.href;
  const titleAttr = attrs?.match(/title\s*=\s*["']([^"']+)["']/i)?.[1];
  const candidateTitle = pickTitle(anchorText, titleAttr, abs.href);
  const existing = found.get(key);
  if (!existing || candidateTitle.length > existing.title.length) {
    found.set(key, { url: key, title: candidateTitle });
  }
}

function pickTitle(anchorText, titleAttr, url) {
  const fromAnchor = (anchorText ?? '').replace(/\s+/g, ' ').trim();
  const fromAttr = decodeEntities(titleAttr ?? '').trim();
  const fromSlug = titleFromUrl(url);
  const options = [fromAnchor, fromAttr, fromSlug].filter((t) => t && t.length >= 4);
  // De slug is meestal de volledige productnaam; ankertekst kan "Bekijk product" zijn.
  return options.sort((a, b) => b.length - a.length)[0] ?? fromSlug;
}

/** Zoekt het product in een winkel en geeft de beste product-URL terug. */
export async function resolveProductUrl(fetcher, shopId, shop, product, { maxChecks = 3 } = {}) {
  if (!shop.searchUrl) return { url: null, error: 'winkel heeft geen zoek-URL' };
  const query = product.queries?.[shopId] ?? product.query ?? product.name;
  const searchUrl = shop.searchUrl.replace('{q}', encodeURIComponent(query));
  const res = await fetcher.text(searchUrl, { delayMs: shop.delayMs });
  if (!res.ok) return { url: null, error: `zoeken mislukt (${res.error})` };

  const candidates = extractCandidates(res.body, shop, res.url);
  const ranked = candidates
    .map((c) => ({ ...c, ...scoreCandidate(c.title, product) }))
    .filter((c) => c.ok)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChecks);

  if (!ranked.length) {
    return { url: null, error: `geen passend zoekresultaat (${candidates.length} links bekeken)` };
  }
  // Bevestig op de productpagina zelf: de echte titel is betrouwbaarder dan een slug.
  for (const candidate of ranked) {
    const page = await fetcher.text(candidate.url, { delayMs: shop.delayMs });
    if (!page.ok) continue;
    const info = extractProduct(page.body, page.url);
    const verdict = scoreCandidate(info.title ?? candidate.title, product);
    if (verdict.ok && info.price != null) {
      return { url: page.url, error: null, page: info };
    }
  }
  return { url: null, error: 'zoekresultaten kwamen niet overeen met het product' };
}

/**
 * Haalt de actuele aanbieding op: gebruikt een bekende URL, zoekt opnieuw als die niet klopt.
 * @returns {Promise<object>} offer
 */
export async function fetchOffer(fetcher, shopId, shop, product, knownUrl) {
  const offer = {
    shop: shopId,
    shopName: shop.name,
    url: knownUrl ?? null,
    price: null,
    currency: 'EUR',
    inStock: null,
    title: null,
    packSize: null,
    unitPrice: null,
    unitLabel: null,
    ok: false,
    error: null,
    fetchedAt: new Date().toISOString(),
  };

  let info = null;
  if (knownUrl) {
    const page = await fetcher.text(knownUrl, { delayMs: shop.delayMs });
    if (page.ok) {
      const parsed = extractProduct(page.body, page.url);
      const verdict = scoreCandidate(parsed.title ?? titleFromUrl(page.url), product);
      if (verdict.ok && parsed.price != null) {
        info = parsed;
        offer.url = page.url;
      } else {
        offer.error = parsed.price == null ? 'geen prijs op de pagina' : `pagina past niet meer (${verdict.reason})`;
      }
    } else {
      offer.error = page.error;
    }
  }

  if (!info) {
    const resolved = await resolveProductUrl(fetcher, shopId, shop, product);
    if (resolved.url) {
      offer.url = resolved.url;
      info = resolved.page ?? null;
      offer.error = null;
    } else {
      offer.error = offer.error ? `${offer.error}; ${resolved.error}` : resolved.error;
    }
  }

  if (!info) return offer;

  offer.title = info.title;
  offer.price = info.price;
  offer.currency = info.currency ?? 'EUR';
  offer.inStock = info.inStock;
  offer.packSize = info.packSize ?? product.packSize ?? null;
  if (offer.packSize) {
    // Stukprijs per luier/doekje; vloeistof en gewicht per 100 ml/100 g.
    const per = offer.packSize.unit === 'stuk' ? 1 : 100;
    const base = unitPrice(offer.price, offer.packSize);
    offer.unitPrice = base == null ? null : Math.round((base * per + Number.EPSILON) * 10000) / 10000;
    offer.unitLabel = unitLabelFor(offer.packSize.unit);
  }
  offer.ok = offer.price != null;
  if (!offer.ok) offer.error = offer.error ?? 'geen prijs gevonden';
  return offer;
}

export function unitLabelFor(unit) {
  if (unit === 'stuk') return 'per stuk';
  if (unit === 'ml') return 'per 100 ml';
  if (unit === 'g') return 'per 100 g';
  return null;
}
