/** Zoeken in een webwinkel en de prijs van een productpagina lezen. */
import { extractLinks, stripTags, decodeEntities } from './html.mjs';
import { extractProduct, unitPrice } from './parse.mjs';
import { bestCandidate, scoreCandidate } from './match.mjs';
import { normalizeGtin, displayGtin } from './identity.mjs';

/**
 * Mag deze pagina bij dit product horen, gelet op de artikelnummers in de catalogus?
 * Zonder lijst in de catalogus (of zonder EAN op de pagina) valt er niets te weerleggen.
 */
export function gtinAllowed(product, gtin) {
  if (product.strictGtin === false) return { ok: true, reason: 'EAN-controle staat uit voor dit product' };
  const allowed = (product.gtins ?? []).map((g) => normalizeGtin(g)).filter(Boolean);
  if (!allowed.length) return { ok: true, reason: 'geen EAN-lijst in de catalogus' };
  const found = normalizeGtin(gtin);
  if (!found) return { ok: true, reason: 'geen EAN op de pagina' };
  return allowed.includes(found)
    ? { ok: true, reason: 'EAN komt overeen' }
    : { ok: false, reason: `EAN ${displayGtin(found)} staat niet in de catalogus` };
}

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

/**
 * Haalt de categoriepagina's van een winkel op, elk hooguit een keer per ronde.
 * Nodig voor winkels die hun zoekpagina in robots.txt verbieden maar wel laten bladeren.
 */
export async function loadBrowsePages(fetcher, shop, cache = new Map()) {
  const pages = [];
  for (const url of shop.browseUrls ?? []) {
    if (!cache.has(url)) cache.set(url, await fetcher.text(url, { delayMs: shop.delayMs }));
    const res = cache.get(url);
    if (res.ok) pages.push(res);
  }
  return pages;
}

/** Zoekt het product in een winkel en geeft de beste product-URL terug. */
export async function resolveProductUrl(fetcher, shopId, shop, product, { maxChecks = 3, browseCache } = {}) {
  const candidates = [];
  const errors = [];

  // Bladeren via categoriepagina's waar zoeken niet mag of niet werkt.
  if (shop.browseUrls?.length) {
    const pages = await loadBrowsePages(fetcher, shop, browseCache ?? new Map());
    if (!pages.length) errors.push('categoriepagina niet op te halen');
    for (const page of pages) candidates.push(...extractCandidates(page.body, shop, page.url));
  }

  if (!candidates.length && shop.searchUrl && shop.discovery !== 'browse') {
    const query = product.queries?.[shopId] ?? product.query ?? product.name;
    const searchUrl = shop.searchUrl.replace('{q}', encodeURIComponent(query));
    const res = await fetcher.text(searchUrl, { delayMs: shop.delayMs });
    if (res.ok) candidates.push(...extractCandidates(res.body, shop, res.url));
    else errors.push(`zoeken mislukt (${res.error})`);
  }

  if (!candidates.length) {
    return { url: null, error: errors.join('; ') || 'geen manier om producten te vinden' };
  }
  const ranked = dedupe(candidates)
    .map((c) => ({ ...c, ...scoreCandidate(c.title, product) }))
    .filter((c) => c.ok)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChecks);

  if (!ranked.length) {
    return { url: null, error: `geen passend resultaat (${candidates.length} links bekeken)` };
  }
  // Bevestig op de productpagina zelf: de echte titel en het EAN zijn betrouwbaarder dan een slug.
  let lastReason = null;
  for (const candidate of ranked) {
    const page = await fetcher.text(candidate.url, { delayMs: shop.delayMs });
    if (!page.ok) continue;
    const info = extractProduct(page.body, page.url);
    const verdict = scoreCandidate(info.title ?? candidate.title, product);
    const identity = gtinAllowed(product, info.gtin);
    if (verdict.ok && identity.ok && info.price != null) {
      return { url: page.url, error: null, page: info };
    }
    if (!identity.ok) lastReason = identity.reason;
  }
  return { url: null, error: lastReason ?? 'gevonden pagina\'s kwamen niet overeen met het product' };
}

function dedupe(candidates) {
  const byUrl = new Map();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    if (!existing || candidate.title.length > existing.title.length) byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()];
}

/**
 * Haalt de actuele aanbieding op: gebruikt een bekende URL, zoekt opnieuw als die niet klopt.
 * @returns {Promise<object>} offer
 */
export async function fetchOffer(fetcher, shopId, shop, product, knownUrl, { browseCache } = {}) {
  const offer = {
    shop: shopId,
    shopName: shop.name,
    url: knownUrl ?? null,
    price: null,
    currency: 'EUR',
    inStock: null,
    title: null,
    packSize: null,
    gtin: null,
    sku: null,
    mpn: null,
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
      const identity = gtinAllowed(product, parsed.gtin);
      if (verdict.ok && identity.ok && parsed.price != null) {
        info = parsed;
        offer.url = page.url;
      } else if (!identity.ok) {
        offer.error = `ander artikel op deze pagina (${identity.reason})`;
      } else {
        offer.error = parsed.price == null ? 'geen prijs op de pagina' : `pagina past niet meer (${verdict.reason})`;
      }
    } else {
      offer.error = page.error;
    }
  }

  if (!info) {
    const resolved = await resolveProductUrl(fetcher, shopId, shop, product, { browseCache });
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
  offer.gtin = info.gtin ?? null;
  offer.sku = info.sku ?? null;
  offer.mpn = info.mpn ?? null;
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
