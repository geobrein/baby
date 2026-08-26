/**
 * Controleert of de aanbiedingen van verschillende winkels echt over hetzelfde
 * artikel gaan, op basis van GTIN/EAN (en SKU als steunbewijs).
 *
 * Niveaus:
 *   exact      - artikelnummer komt overeen met de referentie (catalogus of consensus)
 *   variant    - geldig artikelnummer, maar een ander artikel (meestal een andere verpakking)
 *   afwijkend  - artikelnummer staat niet in de lijst die de catalogus voorschrijft
 *   onbekend   - geen artikelnummer gevonden, of geen tweede winkel om mee te vergelijken
 */
import { normalizeGtin, displayGtin } from './identity.mjs';

export const EXACT = 'exact';
export const VARIANT = 'variant';
export const MISMATCH = 'afwijkend';
export const UNKNOWN = 'onbekend';

/**
 * @param {object} product          catalogusproduct (mag `gtins` en `strictGtin` bevatten)
 * @param {Array} offers            aanbiedingen met (optioneel) `gtin`, `sku`, `packSize`
 * @param {object} [previous]       eerder vastgelegde identiteit per winkel: { shopId: {gtin, sku} }
 * @returns {{offers: Array, reference: string|null, referenceSource: string, issues: Array}}
 */
export function verifyOffers(product, offers, previous = {}) {
  const issues = [];
  const catalogGtins = (product.gtins ?? [])
    .map((g) => normalizeGtin(g))
    .filter(Boolean);
  const strict = product.strictGtin ?? catalogGtins.length > 0;

  const annotated = offers.map((offer) => ({ ...offer, gtin: normalizeGtin(offer.gtin) }));

  // Referentie bepalen: de catalogus wint, anders de code waar minstens twee winkels het over eens zijn.
  const counts = new Map();
  for (const offer of annotated) {
    if (!offer.gtin) continue;
    counts.set(offer.gtin, (counts.get(offer.gtin) ?? 0) + 1);
  }
  let reference = null;
  let referenceSource = 'geen';
  if (catalogGtins.length) {
    reference = catalogGtins[0];
    referenceSource = 'catalogus';
  } else {
    const consensus = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
    if (consensus) {
      [reference] = consensus;
      referenceSource = 'consensus';
    }
  }
  const distinctGtins = counts.size;

  for (const offer of annotated) {
    offer.verification = UNKNOWN;
    offer.gtinDisplay = displayGtin(offer.gtin);

    if (offer.gtin) {
      if (catalogGtins.length) {
        offer.verification = catalogGtins.includes(offer.gtin) ? EXACT : MISMATCH;
      } else if (reference) {
        offer.verification = offer.gtin === reference ? EXACT : VARIANT;
      } else if (distinctGtins > 1) {
        // Geen meerderheid, maar de winkels noemen aantoonbaar verschillende artikelen.
        offer.verification = VARIANT;
      }
    }

    if (offer.verification === MISMATCH) {
      issues.push({
        product: product.id,
        shop: offer.shop,
        type: 'gtin-niet-in-catalogus',
        message: `EAN ${offer.gtinDisplay} staat niet in de lijst van ${product.id}`,
      });
    }

    const before = previous?.[offer.shop]?.gtin ? normalizeGtin(previous[offer.shop].gtin) : null;
    if (before && offer.gtin && before !== offer.gtin) {
      offer.gtinChanged = true;
      issues.push({
        product: product.id,
        shop: offer.shop,
        type: 'gtin-gewijzigd',
        message: `winkel toont nu EAN ${offer.gtinDisplay} in plaats van ${displayGtin(before)} — mogelijk een ander artikel op dezelfde pagina`,
      });
    }
  }

  // Zelfde artikelnummer maar een andere verpakkingsgrootte duidt op een leesfout.
  const packsByGtin = new Map();
  for (const offer of annotated) {
    if (!offer.gtin || !offer.packSize) continue;
    const seen = packsByGtin.get(offer.gtin);
    if (seen && seen.amount !== offer.packSize.amount) {
      issues.push({
        product: product.id,
        shop: offer.shop,
        type: 'verpakking-wijkt-af',
        message: `EAN ${offer.gtinDisplay} heeft hier ${offer.packSize.amount} ${offer.packSize.unit} maar elders ${seen.amount} ${seen.unit}`,
      });
    } else if (!seen) {
      packsByGtin.set(offer.gtin, offer.packSize);
    }
  }

  const kept = strict ? annotated.filter((o) => o.verification !== MISMATCH) : annotated;
  return { offers: kept, reference, referenceSource, issues, strict };
}

/** Werkt data/identity.json bij met wat we vandaag gezien hebben. */
export function recordIdentity(identity, productId, offers, now = new Date()) {
  const perProduct = (identity[productId] ??= {});
  const stamp = now.toISOString();
  for (const offer of offers) {
    if (!offer.gtin && !offer.sku) continue;
    const entry = (perProduct[offer.shop] ??= { gtin: null, sku: null, packSize: null, firstSeen: stamp, changes: [] });
    if (entry.gtin && offer.gtin && entry.gtin !== offer.gtin) {
      entry.changes.unshift({ from: entry.gtin, to: offer.gtin, at: stamp });
      entry.changes.splice(5);
    }
    entry.gtin = offer.gtin ?? entry.gtin;
    entry.sku = offer.sku ?? entry.sku;
    entry.packSize = offer.packSize ?? entry.packSize;
    entry.lastSeen = stamp;
  }
  return identity;
}
