/**
 * Bouwt de merkoverstijgende luiervergelijking: alle luiers van alle merken
 * in een gekozen maat, op een rij gezet op prijs per luier.
 * Pure functies zonder DOM, zodat ze ook in de tests draaien.
 */

export const DIAPER_CATEGORIES = ['luiers', 'luierbroekjes'];

/** Aantal luiers per maand bij een gemiddeld verbruik (5 per dag, 30 dagen). */
export const DIAPERS_PER_MONTH = 150;

/**
 * Zet producten om in een platte lijst van aanbiedingen, gesorteerd op stukprijs.
 * @param {Array} products   producten uit prices.json
 * @param {object} options   { category, sizes, brands, shops, onlyExact, inStockOnly }
 */
export function diaperRows(products, options = {}) {
  const {
    category = 'luiers',
    sizes = [],
    brands = [],
    shops = [],
    onlyExact = false,
    inStockOnly = false,
  } = options;

  const rows = [];
  for (const product of products) {
    if (category && product.category !== category) continue;
    if (sizes.length && !sizes.includes(product.size)) continue;
    if (brands.length && !brands.includes(product.brand)) continue;

    for (const offer of product.offers) {
      if (shops.length && !shops.includes(offer.shop)) continue;
      if (onlyExact && offer.verification !== 'exact') continue;
      if (inStockOnly && offer.inStock === false) continue;
      if (offer.unitPrice == null) continue; // zonder verpakkingsgrootte is een stukprijs onvergelijkbaar
      rows.push({
        productId: product.id,
        product: product.name,
        brand: product.brand,
        size: product.size,
        weight: product.weight,
        shop: offer.shop,
        shopName: offer.shopName,
        url: offer.url,
        price: offer.price,
        unitPrice: offer.unitPrice,
        packSize: offer.packSize,
        inStock: offer.inStock,
        verification: offer.verification,
        gtin: offer.gtin,
        monthly: monthlyCost(offer.unitPrice),
      });
    }
  }

  rows.sort((a, b) => (a.unitPrice - b.unitPrice) || (a.price - b.price));
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function monthlyCost(unitPrice, perMonth = DIAPERS_PER_MONTH) {
  if (unitPrice == null) return null;
  return Math.round(unitPrice * perMonth * 100) / 100;
}

/** De goedkoopste rij per merk, in dezelfde volgorde als de lijst zelf. */
export function cheapestPerBrand(rows) {
  const best = new Map();
  for (const row of rows) {
    const current = best.get(row.brand);
    if (!current || row.unitPrice < current.unitPrice) best.set(row.brand, row);
  }
  return [...best.values()].sort((a, b) => a.unitPrice - b.unitPrice);
}

/** Beschikbare maten binnen een categorie, oplopend. */
export function availableSizes(products, category) {
  return [...new Set(products.filter((p) => p.category === category && p.size).map((p) => p.size))]
    .sort((a, b) => String(a).localeCompare(String(b), 'nl', { numeric: true }));
}

/**
 * De maat die het meest te vergelijken valt: de maat met de meeste merken.
 * Bij gelijk spel wint de laagste maat.
 */
export function defaultSize(products, category) {
  const sizes = availableSizes(products, category);
  let best = null;
  for (const size of sizes) {
    const brands = availableBrands(products, category, [size]).length;
    if (!best || brands > best.brands) best = { size, brands };
  }
  return best?.size ?? null;
}

/** Merken die daadwerkelijk aanbiedingen hebben in deze selectie. */
export function availableBrands(products, category, sizes = []) {
  return [...new Set(products
    .filter((p) => p.category === category && (!sizes.length || sizes.includes(p.size)) && p.offers.length)
    .map((p) => p.brand)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'));
}

/** Korte samenvatting: goedkoopste rij, duurste rij en het verschil per maand. */
export function comparisonSummary(rows) {
  if (!rows.length) return null;
  const cheapest = rows[0];
  const dearest = rows[rows.length - 1];
  return {
    cheapest,
    dearest,
    monthlyDifference: Math.round((dearest.monthly - cheapest.monthly) * 100) / 100,
    brands: new Set(rows.map((r) => r.brand)).size,
    shops: new Set(rows.map((r) => r.shop)).size,
  };
}
