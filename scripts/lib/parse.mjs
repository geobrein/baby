/** Prijzen, verpakkingsgroottes en productgegevens uit een productpagina halen. */
import {
  extractJsonLd, flattenJsonLd, jsonLdType, metaContent, pageTitle, stripTags, decodeEntities,
} from './html.mjs';
import { extractIdentifiers, identifiersFromNode } from './identity.mjs';

/**
 * Leest een prijs uit tekst zoals "€ 12,99", "12.99", "1.234,56" of "€1,234.56".
 * Geeft een getal in euro terug, of null.
 */
export function parsePrice(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? round2(input) : null;
  if (input == null) return null;
  const text = decodeEntities(String(input));
  const m = text.match(/-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/);
  if (!m) return null;
  let raw = m[0].replace(/\s/g, '');
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // De laatste van de twee is het decimaalteken.
    const decSep = lastComma > lastDot ? ',' : '.';
    const thouSep = decSep === ',' ? '.' : ',';
    raw = raw.split(thouSep).join('');
    raw = raw.replace(decSep, '.');
  } else if (lastComma !== -1) {
    const decimals = raw.length - lastComma - 1;
    raw = decimals <= 2 ? raw.replace(',', '.') : raw.split(',').join('');
  } else if (lastDot !== -1) {
    const decimals = raw.length - lastDot - 1;
    if (decimals === 3) raw = raw.split('.').join('');
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? round2(value) : null;
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const PIECE_WORDS = 'stuks|stuk|st\\.|luiers|luier|doekjes|doekje|wipes|tissues|billendoekjes|pants|broekjes';

/**
 * Haalt de verpakkingsgrootte uit een producttitel of omschrijving.
 * Geeft { amount, unit } waarbij unit 'stuk', 'ml' of 'g' is, of null.
 */
export function parsePackSize(text) {
  if (!text) return null;
  const s = decodeEntities(String(text)).toLowerCase().replace(/\s+/g, ' ');

  // "4 x 44 stuks" / "3x52 doekjes" -> 176 stuks
  const multi = s.match(new RegExp(`(\\d{1,3})\\s*[x×]\\s*(\\d{1,4})\\s*(?:${PIECE_WORDS})\\b`));
  if (multi) return { amount: Number(multi[1]) * Number(multi[2]), unit: 'stuk' };

  // "12 x 500 ml" -> 6000 ml
  const multiVol = s.match(/(\d{1,3})\s*[x×]\s*(\d{1,4}(?:[.,]\d+)?)\s*(ml|milliliter|l|liter|g|gr|gram|kg)\b/);
  if (multiVol) {
    const one = toBaseUnit(Number(multiVol[2].replace(',', '.')), multiVol[3]);
    if (one) return { amount: round2(one.amount * Number(multiVol[1])), unit: one.unit };
  }

  // "82 stuks" / "160 luiers", maar niet het maatnummer in "maat 4 luiers".
  const pieceRe = new RegExp(`(\\d{1,4})\\s*(?:${PIECE_WORDS})\\b`, 'g');
  for (const m of s.matchAll(pieceRe)) {
    const before = s.slice(0, m.index);
    if (/(?:maat|maten|size|mt\.?|nr\.?)\s*$/.test(before)) continue;
    const amount = Number(m[1]);
    if (amount > 0) return { amount, unit: 'stuk' };
  }

  // "maat 4 - 44 st" wordt hierboven al gepakt; anders volume/gewicht.
  const vol = s.match(/(\d{1,4}(?:[.,]\d+)?)\s*(ml|milliliter|l|liter|g|gr|gram|kg)\b/);
  if (vol) return toBaseUnit(Number(vol[1].replace(',', '.')), vol[2]);

  return null;
}

function toBaseUnit(amount, unit) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  switch (unit) {
    case 'ml': case 'milliliter': return { amount: round2(amount), unit: 'ml' };
    case 'l': case 'liter': return { amount: round2(amount * 1000), unit: 'ml' };
    case 'g': case 'gr': case 'gram': return { amount: round2(amount), unit: 'g' };
    case 'kg': return { amount: round2(amount * 1000), unit: 'g' };
    default: return null;
  }
}

const IN_STOCK = /instock|in_stock|limitedavailability|onlineonly|presale|preorder|backorder/i;
const OUT_OF_STOCK = /outofstock|out_of_stock|soldout|discontinued/i;

/**
 * Haalt titel/prijs/voorraad/afbeelding uit een productpagina.
 * Volgorde: schema.org JSON-LD -> Open Graph / microdata meta -> HTML-terugval.
 */
export function extractProduct(html, url = '') {
  const result = {
    url, title: null, price: null, currency: 'EUR', inStock: null, image: null, packSize: null,
    gtin: null, sku: null, mpn: null, source: null,
  };
  if (!html) return result;

  const product = findProductNode(html);
  if (product) {
    result.source = 'json-ld';
    const ids = identifiersFromNode(product);
    result.gtin = ids.gtin;
    result.sku = ids.sku;
    result.mpn = ids.mpn;
    result.title = cleanText(product.name) ?? result.title;
    result.image = firstImage(product.image) ?? result.image;
    const offer = pickOffer(product.offers);
    if (offer) {
      result.price = parsePrice(offer.price ?? offer.lowPrice ?? offer.highPrice ?? offer.priceSpecification?.price);
      const cur = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency;
      if (cur) result.currency = String(cur).toUpperCase();
      const avail = String(offer.availability ?? offer.itemCondition ?? '');
      if (OUT_OF_STOCK.test(avail)) result.inStock = false;
      else if (IN_STOCK.test(avail)) result.inStock = true;
    }
    const size = product.size ?? product.weight?.value ?? product.additionalProperty;
    result.packSize = parsePackSize(typeof size === 'string' ? size : null);
  }

  if (result.price == null) {
    const meta = metaContent(html, 'product:price:amount')
      ?? metaContent(html, 'og:price:amount')
      ?? metaContent(html, 'price');
    const parsed = parsePrice(meta);
    if (parsed != null) {
      result.price = parsed;
      result.source = result.source ?? 'meta';
    }
  }
  if (result.price == null) {
    const m = html.match(/data-(?:product-)?price\s*=\s*["']([^"']+)["']/i);
    const parsed = parsePrice(m?.[1]);
    if (parsed != null) {
      result.price = parsed;
      result.source = result.source ?? 'attribute';
    }
  }

  if (result.inStock == null) {
    const avail = metaContent(html, 'product:availability') ?? metaContent(html, 'og:availability');
    if (avail) result.inStock = !OUT_OF_STOCK.test(avail) && IN_STOCK.test(avail.replace(/\s/g, ''));
  }

  result.title = result.title
    ?? cleanText(metaContent(html, 'og:title'))
    ?? cleanText(pageTitle(html));
  result.image = result.image ?? metaContent(html, 'og:image');
  result.packSize = result.packSize ?? parsePackSize(result.title) ?? parsePackSize(metaContent(html, 'og:description'));

  if (!result.gtin || !result.sku) {
    const ids = extractIdentifiers(html);
    result.gtin ??= ids.gtin;
    result.sku ??= ids.sku;
    result.mpn ??= ids.mpn;
  }

  return result;
}

function findProductNode(html) {
  const nodes = flattenJsonLd(extractJsonLd(html));
  const products = nodes.filter((n) => jsonLdType(n).some((t) => t === 'product' || t === 'productgroup'));
  // Voorkeur voor een node die daadwerkelijk een prijs bevat.
  return products.find((n) => pickOffer(n.offers)) ?? products[0] ?? null;
}

function pickOffer(offers) {
  if (!offers) return null;
  const list = (Array.isArray(offers) ? offers : [offers]).flatMap((o) => (o?.offers ? [o, ...[].concat(o.offers)] : [o]));
  const withPrice = list.filter((o) => o && (o.price != null || o.lowPrice != null || o.priceSpecification?.price != null));
  if (!withPrice.length) return null;
  // Laagste prijs wint (winkels tonen soms meerdere aanbieders op een pagina).
  return withPrice.sort((a, b) => {
    const pa = parsePrice(a.price ?? a.lowPrice ?? a.priceSpecification?.price) ?? Infinity;
    const pb = parsePrice(b.price ?? b.lowPrice ?? b.priceSpecification?.price) ?? Infinity;
    return pa - pb;
  })[0];
}

function firstImage(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return firstImage(image[0]);
  if (typeof image === 'object') return image.url ?? image.contentUrl ?? null;
  return null;
}

function cleanText(value) {
  if (!value) return null;
  const text = stripTags(String(value));
  return text || null;
}

/** Prijs per stuk/ml/g, afgerond op 4 decimalen. */
export function unitPrice(price, packSize) {
  if (price == null || !packSize?.amount) return null;
  const value = price / packSize.amount;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
