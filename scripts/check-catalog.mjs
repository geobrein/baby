#!/usr/bin/env node
/**
 * Controleert of elk catalogusproduct in elke winkel gevonden wordt.
 * Draai dit na het toevoegen van producten: het laat zien welke zoektermen
 * of match-regels nog bijgesteld moeten worden.
 *
 *   node scripts/check-catalog.mjs [--only=kruidvat] [--product=id] [--limit=n]
 */
import { Fetcher } from './lib/http.mjs';
import { resolveProductUrl } from './lib/shop.mjs';
import { paths } from './lib/paths.mjs';
import { readJson, writeJson } from './lib/store.mjs';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const productFilter = args.find((a) => a.startsWith('--product='))?.slice(10).split(',');
const limit = Number.parseInt(args.find((a) => a.startsWith('--limit='))?.slice(8) ?? '', 10);

const catalog = await readJson(paths.catalog);
const shops = await readJson(paths.shops);
let products = catalog.products;
if (productFilter) products = products.filter((p) => productFilter.includes(p.id));
if (Number.isFinite(limit)) products = products.slice(0, limit);

const activeShops = Object.entries(shops).filter(([id, shop]) => (only ? only.includes(id) : shop.enabled !== false));
const fetcher = new Fetcher({ log: () => {} });
const rows = [];

await Promise.all(activeShops.map(async ([shopId, shop]) => {
  for (const product of products) {
    if (Array.isArray(product.shops) && !product.shops.includes(shopId)) continue;
    const pinned = product.links?.[shopId];
    const result = pinned
      ? { url: pinned, error: null }
      : await resolveProductUrl(fetcher, shopId, shop, product);
    rows.push({
      product: product.id,
      shop: shopId,
      ok: Boolean(result.url),
      url: result.url,
      price: result.page?.price ?? null,
      error: result.error,
    });
    const mark = result.url ? 'OK ' : 'X  ';
    console.log(`${mark} ${shop.name.padEnd(14)} ${product.id.padEnd(34)} ${result.url ?? result.error}`);
  }
}));

const failed = rows.filter((r) => !r.ok);
await writeJson(paths.report.replace('report.json', 'catalog-check.json'), {
  ranAt: new Date().toISOString(),
  total: rows.length,
  failed: failed.length,
  rows,
});
console.log(`\n${rows.length - failed.length}/${rows.length} combinaties gevonden. Rapport: data/catalog-check.json`);
if (failed.length) {
  console.log('Niet gevonden:');
  for (const row of failed) console.log(`  ${row.shop} / ${row.product}: ${row.error}`);
}
