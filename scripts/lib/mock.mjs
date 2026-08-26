/** Verzint stabiele demoprijzen zodat de site zonder netwerk te bekijken is. */
import { unitLabelFor } from './shop.mjs';
import { unitPrice } from './parse.mjs';
import { checkDigit } from './identity.mjs';

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const BASE_BY_CATEGORY = {
  luiers: { price: 22, pack: 100, unit: 'stuk' },
  luierbroekjes: { price: 20, pack: 76, unit: 'stuk' },
  billendoekjes: { price: 9, pack: 300, unit: 'stuk' },
  verzorging: { price: 8, pack: null, unit: null },
};

/** Demo-EAN in de 200-reeks: die is gereserveerd voor intern gebruik en botst dus niet met echte artikelen. */
function demoGtin(seedText) {
  const body = `200${String(Math.floor(hash(seedText) * 1e9)).padStart(9, '0')}`.slice(0, 12);
  return `${body}${checkDigit(body)}`;
}

export function mockOffer(shopId, shop, product, date = new Date()) {
  const base = BASE_BY_CATEGORY[product.category] ?? BASE_BY_CATEGORY.verzorging;
  const day = date.toISOString().slice(0, 10);
  const seed = hash(`${product.id}|${shopId}`);
  const drift = hash(`${product.id}|${shopId}|${day}`);

  // De meeste winkels verkopen dezelfde verpakking (zelfde EAN); een van hen een grotere doos,
  // en een ander vermeldt geen artikelnummer. Zo zijn alle verificatieniveaus zichtbaar.
  const bigPackShop = seed > 0.5 ? 'bol' : 'babypark';
  const noGtinShop = seed > 0.5 ? 'babypark' : 'bol';
  const isBigPack = shopId === bigPackShop;
  const standardPack = base.pack ? Math.round(base.pack * (0.75 + hash(product.id) * 0.5)) : null;
  const packSize = product.packSize
    ?? (standardPack ? { amount: isBigPack ? Math.round(standardPack * 1.8) : standardPack, unit: base.unit } : null);
  const scale = packSize && base.pack ? packSize.amount / base.pack : 1;
  const price = Math.round((base.price * scale * (0.82 + seed * 0.4) * (0.97 + drift * 0.08)) * 100) / 100;
  const gtin = shopId === noGtinShop
    ? null
    : demoGtin(`${product.id}${isBigPack ? '|groot' : ''}`);

  const offer = {
    shop: shopId,
    shopName: shop.name,
    url: `${shop.site}/zoeken?q=${encodeURIComponent(product.query ?? product.name)}`,
    price,
    currency: 'EUR',
    inStock: drift > 0.05,
    title: `${product.name} (demo)`,
    packSize,
    gtin,
    sku: `DEMO-${shopId.toUpperCase()}-${String(Math.floor(seed * 100000)).padStart(5, '0')}`,
    mpn: null,
    unitPrice: null,
    unitLabel: null,
    ok: true,
    error: null,
    mock: true,
    fetchedAt: date.toISOString(),
  };
  if (packSize) {
    const per = packSize.unit === 'stuk' ? 1 : 100;
    const value = unitPrice(price, packSize);
    offer.unitPrice = value == null ? null : Math.round((value * per + Number.EPSILON) * 10000) / 10000;
    offer.unitLabel = unitLabelFor(packSize.unit);
  }
  return offer;
}
