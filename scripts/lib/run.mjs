/** De prijsronde zelf: winkels aflopen, prijzen opslaan, site-data schrijven. */
import { Fetcher } from './http.mjs';
import { fetchOffer } from './shop.mjs';
import { mockOffer } from './mock.mjs';
import { paths as defaultPaths } from './paths.mjs';
import { readJson, writeJson, appendHistory, lowestInPeriod } from './store.mjs';
import { compareOffers } from './rank.mjs';

export function parseArgs(argv) {
  const args = { mock: false, robots: true, only: null, product: null, limit: null, quiet: false, help: false };
  for (const arg of argv) {
    if (arg === '--mock') args.mock = true;
    else if (arg === '--no-robots') args.robots = false;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--only=')) args.only = split(arg.slice(7));
    else if (arg.startsWith('--product=')) args.product = split(arg.slice(10));
    else if (arg.startsWith('--limit=')) args.limit = Number.parseInt(arg.slice(8), 10);
    else throw new Error(`Onbekende optie: ${arg}`);
  }
  return args;
}

const split = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);

export const HELP = `babyprijs - prijzen ophalen

  --mock              gebruik demoprijzen (geen netwerkverkeer)
  --only=a,b          alleen deze winkels
  --product=id,id     alleen deze producten
  --limit=n           maximaal n producten
  --no-robots         robots.txt niet controleren (alleen voor eigen tests)
  --quiet             minder logregels`;

/**
 * Voert een complete prijsronde uit.
 * @returns {Promise<{payload: object, problems: Array}>}
 */
export async function run(args, { paths = defaultPaths, log = console.log, fetcher: injected } = {}) {
  const catalog = await readJson(paths.catalog);
  const shops = await readJson(paths.shops);
  if (!catalog?.products?.length) throw new Error(`${paths.catalog} bevat geen producten`);
  if (!shops || !Object.keys(shops).length) throw new Error(`${paths.shops} bevat geen winkels`);

  let products = catalog.products;
  if (args.product) products = products.filter((p) => args.product.includes(p.id));
  if (args.limit) products = products.slice(0, args.limit);
  if (!products.length) throw new Error('Geen producten over na filteren');

  const activeShops = Object.entries(shops).filter(([id, shop]) => (args.only ? args.only.includes(id) : shop.enabled !== false));
  if (!activeShops.length) throw new Error('Geen actieve winkels; controleer data/shops.json of --only');

  const resolved = (await readJson(paths.resolved, {})) ?? {};
  const history = (await readJson(paths.history, {})) ?? {};
  const startedAt = new Date();
  const today = startedAt.toISOString().slice(0, 10);

  const fetcher = injected ?? new Fetcher({ respectRobots: args.robots, log });
  const offersByProduct = new Map(products.map((p) => [p.id, []]));
  const problems = [];

  log(`${products.length} producten x ${activeShops.length} winkels${args.mock ? ' (demo)' : ''}`);

  // Winkels parallel, producten binnen een winkel netjes op volgorde.
  await Promise.all(activeShops.map(async ([shopId, shop]) => {
    for (const product of products) {
      if (Array.isArray(product.shops) && !product.shops.includes(shopId)) continue;
      const key = `${product.id}|${shopId}`;
      let offer;
      try {
        offer = args.mock
          ? mockOffer(shopId, shop, product, startedAt)
          : await fetchOffer(fetcher, shopId, shop, product, product.links?.[shopId] ?? resolved[key]?.url);
      } catch (err) {
        offer = { shop: shopId, shopName: shop.name, ok: false, error: err.message, url: null, price: null };
      }

      if (offer.ok) {
        resolved[key] = { url: offer.url, title: offer.title, resolvedAt: startedAt.toISOString() };
        appendHistory(history, product.id, shopId, today, offer.price, offer.unitPrice);
        offersByProduct.get(product.id).push(offer);
        log(`  ${shop.name}: ${product.name} -> € ${offer.price.toFixed(2)}`);
      } else {
        delete resolved[key];
        problems.push({ product: product.id, shop: shopId, error: offer.error ?? 'onbekend' });
        log(`  ${shop.name}: ${product.name} -> geen prijs (${offer.error ?? 'onbekend'})`);
      }
    }
  }));

  const payload = buildPayload({ catalog, shops, products, offersByProduct, history, args, startedAt });

  await writeJson(paths.sitePrices, payload);
  // Demoprijzen mogen de echte cache en historie niet vervuilen.
  if (!args.mock) {
    await writeJson(paths.resolved, resolved);
    await writeJson(paths.history, history);
    await writeJson(paths.report, {
      ranAt: startedAt.toISOString(),
      mock: false,
      shops: activeShops.map(([id]) => id),
      productCount: products.length,
      offerCount: payload.stats.offers,
      problems,
    });
  }

  return { payload, problems };
}

function buildPayload({ catalog, shops, products, offersByProduct, history, args, startedAt }) {
  const usedShopIds = new Set();
  const out = [];

  for (const product of products) {
    const offers = offersByProduct.get(product.id).filter((o) => o.ok && o.url).sort(compareOffers);
    if (!offers.length) continue;
    offers.forEach((o) => usedShopIds.add(o.shop));
    const best = offers[0];
    out.push({
      id: product.id,
      name: product.name,
      brand: product.brand ?? null,
      category: product.category,
      size: product.size ?? null,
      weight: product.weight ?? null,
      unit: product.unit ?? null,
      bestPrice: best.price,
      bestUnitPrice: best.unitPrice ?? null,
      unitLabel: best.unitLabel ?? null,
      lowest30: lowestInPeriod(history, product.id, 30, startedAt),
      offers: offers.map((o) => ({
        shop: o.shop,
        shopName: o.shopName,
        url: o.url,
        price: o.price,
        unitPrice: o.unitPrice ?? null,
        unitLabel: o.unitLabel ?? null,
        packSize: o.packSize ?? null,
        inStock: o.inStock,
        title: o.title ?? null,
      })),
    });
  }

  const shopInfo = {};
  for (const id of usedShopIds) shopInfo[id] = { name: shops[id].name, site: shops[id].site };

  return {
    updatedAt: startedAt.toISOString(),
    mock: args.mock,
    categories: catalog.categories ?? [],
    shops: shopInfo,
    products: out,
    stats: {
      products: products.length,
      productsWithOffers: out.length,
      offers: out.reduce((n, p) => n + p.offers.length, 0),
      shops: usedShopIds.size,
    },
  };
}
