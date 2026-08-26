/**
 * Artikelnummers (GTIN/EAN/UPC, SKU, MPN) lezen, valideren en vergelijken.
 * Hiermee stellen we vast of twee winkels echt hetzelfde artikel verkopen.
 */
import { flattenJsonLd, extractJsonLd, jsonLdType, metaContent } from './html.mjs';

/** Alleen cijfers overhouden. */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Controleert het controlecijfer van een GTIN-8/12/13/14.
 * ISBN- en ISSN-achtige codes met een letter vallen af omdat alleen cijfers tellen.
 */
export function isValidGtin(value) {
  const digits = digitsOnly(value);
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  if (/^0+$/.test(digits)) return false;
  const padded = digits.padStart(14, '0');
  let sum = 0;
  for (let i = 0; i < 13; i += 1) {
    sum += Number(padded[i]) * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(padded[13]);
}

/** Berekent het controlecijfer bij de eerste 7, 11, 12 of 13 cijfers van een GTIN. */
export function checkDigit(body) {
  const digits = digitsOnly(body);
  const padded = digits.padStart(13, '0');
  let sum = 0;
  for (let i = 0; i < 13; i += 1) {
    sum += Number(padded[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Normaliseert naar GTIN-14 zodat UPC-12 en EAN-13 van hetzelfde artikel gelijk zijn. */
export function normalizeGtin(value) {
  const digits = digitsOnly(value);
  if (!isValidGtin(digits)) return null;
  return digits.padStart(14, '0');
}

/** Toont een genormaliseerde GTIN weer als EAN-13 wanneer dat kan. */
export function displayGtin(gtin14) {
  if (!gtin14) return null;
  const trimmed = String(gtin14).replace(/^0+/, '');
  if (trimmed.length <= 13) return trimmed.padStart(13, '0');
  return String(gtin14);
}

export function sameGtin(a, b) {
  const na = normalizeGtin(a);
  const nb = normalizeGtin(b);
  return Boolean(na && nb && na === nb);
}

const GTIN_KEYS = ['gtin14', 'gtin13', 'gtin12', 'gtin8', 'gtin', 'ean', 'europeanArticleNumber'];

/** Haalt gtin/sku/mpn uit een schema.org-node (inclusief de offers eronder). */
export function identifiersFromNode(node) {
  const found = { gtin: null, sku: null, mpn: null };
  if (!node || typeof node !== 'object') return found;

  const visit = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const key of GTIN_KEYS) {
      if (!found.gtin && obj[key] != null) {
        const normalized = normalizeGtin(obj[key]);
        if (normalized) found.gtin = normalized;
      }
    }
    if (!found.gtin && obj.productID != null) {
      const normalized = normalizeGtin(String(obj.productID).replace(/^(ean|gtin|upc)[:_-]?/i, ''));
      if (normalized) found.gtin = normalized;
    }
    if (!found.sku && obj.sku != null) found.sku = String(obj.sku).trim() || null;
    if (!found.mpn && obj.mpn != null) found.mpn = String(obj.mpn).trim() || null;
    for (const key of ['offers', 'hasVariant', 'isVariantOf', 'additionalProperty']) {
      if (obj[key]) visit(obj[key], depth + 1);
    }
  };

  visit(node);
  return found;
}

/** Haalt gtin/sku/mpn uit een complete productpagina. */
export function extractIdentifiers(html) {
  const result = { gtin: null, sku: null, mpn: null };
  if (!html) return result;

  const nodes = flattenJsonLd(extractJsonLd(html));
  for (const node of nodes) {
    if (!jsonLdType(node).some((t) => t === 'product' || t === 'productgroup')) continue;
    const found = identifiersFromNode(node);
    result.gtin ??= found.gtin;
    result.sku ??= found.sku;
    result.mpn ??= found.mpn;
    if (result.gtin && result.sku) break;
  }

  if (!result.gtin) {
    for (const key of ['product:ean', 'og:upc', 'product:retailer_part_no', 'gtin13', 'ean']) {
      const normalized = normalizeGtin(metaContent(html, key));
      if (normalized) {
        result.gtin = normalized;
        break;
      }
    }
  }
  if (!result.sku) {
    result.sku = metaContent(html, 'product:retailer_item_id') ?? metaContent(html, 'sku') ?? null;
  }

  // Losse EAN-vermelding in de specificatietabel, bijvoorbeeld "EAN: 8006540090992".
  if (!result.gtin) {
    const m = html.match(/\b(?:ean|gtin|barcode|artikelnummer)\b[^0-9]{0,20}(\d{8,14})/i);
    const normalized = normalizeGtin(m?.[1]);
    if (normalized) result.gtin = normalized;
  }

  return result;
}
