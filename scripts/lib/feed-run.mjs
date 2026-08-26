/** Feeds ophalen en omzetten in aanbiedingen, in dezelfde vorm als bij het scrapen. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadFeed, streamFeedRows, matchFeedToProducts } from './feed.mjs';
import { unitLabelFor } from './shop.mjs';
import { unitPrice } from './parse.mjs';
import { DEFAULT_USER_AGENT } from './http.mjs';

/**
 * Loopt de geconfigureerde feeds af waarvoor een URL is ingesteld.
 * @returns {Promise<{offers: Map<string, Array>, problems: Array, used: Array}>}
 */
export async function collectFeedOffers({
  feeds = [], shops = {}, products = [], env = process.env, log = () => {}, download = downloadFeed,
} = {}) {
  const offers = new Map();
  const problems = [];
  const used = [];

  const active = feeds.filter((feed) => feed.enabled !== false && env[feed.urlEnv]);
  const skipped = feeds.filter((feed) => feed.enabled !== false && !env[feed.urlEnv]);
  for (const feed of skipped) log(`  feed ${feed.name}: overgeslagen, ${feed.urlEnv} is niet ingesteld`);
  if (!active.length) return { offers, problems, used };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'babyprijs-feed-'));
  try {
    for (const feed of active) {
      const shop = shops[feed.shop];
      if (!shop) {
        problems.push({ product: '(feed)', shop: feed.shop, error: `feed ${feed.id} verwijst naar een onbekende winkel` });
        continue;
      }
      const file = path.join(dir, `${feed.id}.data`);
      try {
        const { bytes } = await download(env[feed.urlEnv], file, { userAgent: DEFAULT_USER_AGENT });
        const rows = streamFeedRows(file, { format: feed.format ?? 'auto', delimiter: feed.delimiter });
        const matches = await matchFeedToProducts(rows, products, feed.mapping);
        log(`  feed ${feed.name}: ${Math.round(bytes / 1024)} kB, ${matches.size} producten herkend`);
        used.push({ id: feed.id, shop: feed.shop, bytes, matched: matches.size });

        for (const [productId, { row }] of matches) {
          const list = offers.get(productId) ?? [];
          list.push(toOffer(row, feed, shop, products.find((p) => p.id === productId)));
          offers.set(productId, list);
        }
      } catch (err) {
        problems.push({ product: '(feed)', shop: feed.shop, error: `feed ${feed.id}: ${err.message}` });
        log(`  feed ${feed.name}: mislukt (${err.message})`);
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  return { offers, problems, used };
}

function toOffer(row, feed, shop, product) {
  const packSize = row.packSize ?? product?.packSize ?? null;
  const offer = {
    shop: feed.shop,
    shopName: shop.name,
    url: row.url,
    price: row.price,
    currency: row.currency ?? 'EUR',
    inStock: row.inStock,
    title: row.title,
    packSize,
    gtin: row.gtin,
    sku: row.sku,
    mpn: null,
    unitPrice: null,
    unitLabel: null,
    source: 'feed',
    ok: true,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
  if (packSize) {
    const per = packSize.unit === 'stuk' ? 1 : 100;
    const base = unitPrice(offer.price, packSize);
    offer.unitPrice = base == null ? null : Math.round((base * per + Number.EPSILON) * 10000) / 10000;
    offer.unitLabel = unitLabelFor(packSize.unit);
  }
  return offer;
}
