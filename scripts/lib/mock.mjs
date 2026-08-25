/** Verzint stabiele demoprijzen zodat de site zonder netwerk te bekijken is. */
import { unitLabelFor } from './shop.mjs';
import { unitPrice } from './parse.mjs';

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

export function mockOffer(shopId, shop, product, date = new Date()) {
  const base = BASE_BY_CATEGORY[product.category] ?? BASE_BY_CATEGORY.verzorging;
  const day = date.toISOString().slice(0, 10);
  const seed = hash(`${product.id}|${shopId}`);
  const drift = hash(`${product.id}|${shopId}|${day}`);
  const packSize = product.packSize
    ?? (base.pack ? { amount: Math.round(base.pack * (0.7 + seed * 0.8)), unit: base.unit } : null);
  const scale = packSize && base.pack ? packSize.amount / base.pack : 1;
  const price = Math.round((base.price * scale * (0.82 + seed * 0.4) * (0.97 + drift * 0.08)) * 100) / 100;

  const offer = {
    shop: shopId,
    shopName: shop.name,
    url: `${shop.site}/zoeken?q=${encodeURIComponent(product.query ?? product.name)}`,
    price,
    currency: 'EUR',
    inStock: drift > 0.05,
    title: `${product.name} (demo)`,
    packSize,
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
