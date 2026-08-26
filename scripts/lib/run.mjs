/** De prijsronde zelf: winkels aflopen, prijzen opslaan, site-data schrijven. */
import { Fetcher } from './http.mjs';
import { fetchOffer } from './shop.mjs';
import { mockOffer } from './mock.mjs';
import { paths as defaultPaths } from './paths.mjs';
import { readJson, writeJson, appendHistory, lowestInPeriod } from './store.mjs';
import { compareOffers } from './rank.mjs';
import { verifyOffers, recordIdentity, EXACT } from './verify.mjs';
import { displayGtin } from './identity.mjs';

export const DEFAULT_BUDGET_MINUTES = 25;
export const DEFAULT_MAX_FAILURES = 6;

export function parseArgs(argv) {
  const args = {
    mock: false, robots: true, only: null, product: null, limit: null, quiet: false, help: false,
    budgetMinutes: DEFAULT_BUDGET_MINUTES, maxFailures: DEFAULT_MAX_FAILURES,
  };
  for (const arg of argv) {
    if (arg === '--mock') args.mock = true;
    else if (arg === '--no-robots') args.robots = false;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--only=')) args.only = split(arg.slice(7));
    else if (arg.startsWith('--product=')) args.product = split(arg.slice(10));
    else if (arg.startsWith('--limit=')) args.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--budget=')) args.budgetMinutes = number(arg.slice(9), 'budget');
    else if (arg.startsWith('--max-failures=')) args.maxFailures = number(arg.slice(15), 'max-failures');
    else throw new Error(`Onbekende optie: ${arg}`);
  }
  return args;
}

function number(value, name) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} moet een positief getal zijn`);
  return parsed;
}

const split = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);

export const HELP = `babyprijs - prijzen ophalen

  --mock              gebruik demoprijzen (geen netwerkverkeer)
  --only=a,b          alleen deze winkels
  --product=id,id     alleen deze producten
  --limit=n           maximaal n producten
  --budget=minuten    stop met ophalen na zoveel minuten en bewaar wat er is (standaard 25)
  --max-failures=n    sla een winkel over na n mislukkingen op rij (standaard 6)
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
  const identity = (await readJson(paths.identity, {})) ?? {};
  const startedAt = new Date();
  const today = startedAt.toISOString().slice(0, 10);

  const fetcher = injected ?? new Fetcher({ respectRobots: args.robots, log });
  const offersByProduct = new Map(products.map((p) => [p.id, []]));
  const problems = [];

  log(`${products.length} producten x ${activeShops.length} winkels${args.mock ? ' (demo)' : ''}`);

  // Winkels parallel, producten binnen een winkel netjes op volgorde.
  const budgetMs = (args.budgetMinutes ?? DEFAULT_BUDGET_MINUTES) * 60_000;
  const maxFailures = args.maxFailures ?? DEFAULT_MAX_FAILURES;
  const deadline = startedAt.getTime() + budgetMs;

  await Promise.all(activeShops.map(async ([shopId, shop]) => {
    let consecutiveFailures = 0;
    for (const product of products) {
      if (Array.isArray(product.shops) && !product.shops.includes(shopId)) continue;

      // Een winkel die blijft weigeren mag de rest van de ronde niet opeten.
      if (consecutiveFailures >= maxFailures) {
        problems.push({
          product: '(rest)',
          shop: shopId,
          error: `winkel overgeslagen na ${consecutiveFailures} mislukkingen op rij`,
        });
        log(`  ${shop.name}: overgeslagen na ${consecutiveFailures} mislukkingen op rij`);
        break;
      }
      // Liever een halve ronde bewaren dan door een tijdslimiet met lege handen staan.
      if (!args.mock && Date.now() > deadline) {
        problems.push({ product: '(rest)', shop: shopId, error: 'tijdbudget bereikt, rest overgeslagen' });
        log(`  ${shop.name}: tijdbudget van ${args.budgetMinutes} minuten bereikt`);
        break;
      }

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
        consecutiveFailures = 0;
        resolved[key] = { url: offer.url, title: offer.title, resolvedAt: startedAt.toISOString() };

        appendHistory(history, product.id, shopId, today, offer.price, offer.unitPrice);
        offersByProduct.get(product.id).push(offer);
        log(`  ${shop.name}: ${product.name} -> € ${offer.price.toFixed(2)}`);
      } else {
        consecutiveFailures += 1;
        forgetResolved(resolved, key, offer.error);
        problems.push({ product: product.id, shop: shopId, error: offer.error ?? 'onbekend' });
        log(`  ${shop.name}: ${product.name} -> geen prijs (${offer.error ?? 'onbekend'})`);
      }
    }
  }));

  // Artikelnummers vergelijken: horen deze aanbiedingen wel bij hetzelfde artikel?
  const verification = new Map();
  for (const product of products) {
    const raw = offersByProduct.get(product.id) ?? [];
    if (!raw.length) continue;
    const result = verifyOffers(product, raw, identity[product.id]);
    offersByProduct.set(product.id, result.offers);
    verification.set(product.id, result);
    recordIdentity(identity, product.id, result.offers, startedAt);
    for (const issue of result.issues) {
      problems.push({ product: issue.product, shop: issue.shop, error: `${issue.type}: ${issue.message}` });
      log(`  let op: ${issue.message} (${product.name}, ${issue.shop})`);
    }
  }

  const payload = buildPayload({ catalog, shops, products, offersByProduct, verification, history, args, startedAt });

  await writeJson(paths.sitePrices, payload);
  // Demoprijzen mogen de echte cache en historie niet vervuilen.
  if (!args.mock) {
    await writeJson(paths.resolved, resolved);
    await writeJson(paths.history, history);
    await writeJson(paths.identity, identity);
    await writeJson(paths.report, {
      ranAt: startedAt.toISOString(),
      mock: false,
      durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      budgetMinutes: args.budgetMinutes,
      shops: activeShops.map(([id]) => id),
      productCount: products.length,
      offerCount: payload.stats.offers,
      problems,
    });
  }

  return { payload, problems };
}

/**
 * Een storing bij de winkel is geen reden om een goede product-URL weg te gooien:
 * die kost een zoekopdracht om terug te vinden. Alleen bij een pagina die aantoonbaar
 * niet meer klopt, of na drie mislukte rondes, vergeten we hem.
 */
export const MAX_CACHED_FAILURES = 3;

function forgetResolved(resolved, key, error = '') {
  const entry = resolved[key];
  if (!entry) return;
  const wrongPage = /past niet meer|ander artikel|geen prijs op de pagina/i.test(error ?? '');
  const failures = (entry.failures ?? 0) + 1;
  if (wrongPage || failures >= MAX_CACHED_FAILURES) delete resolved[key];
  else resolved[key] = { ...entry, failures };
}

function buildPayload({ catalog, shops, products, offersByProduct, verification, history, args, startedAt }) {
  const usedShopIds = new Set();
  const out = [];

  for (const product of products) {
    const offers = offersByProduct.get(product.id).filter((o) => o.ok && o.url).sort(compareOffers);
    if (!offers.length) continue;
    offers.forEach((o) => usedShopIds.add(o.shop));
    const best = offers[0];
    const check = verification?.get(product.id);
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
      gtin: displayGtin(check?.reference ?? null),
      gtinSource: check?.referenceSource ?? 'geen',
      verifiedOffers: offers.filter((o) => o.verification === EXACT).length,
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
        gtin: o.gtinDisplay ?? null,
        sku: o.sku ?? null,
        verification: o.verification ?? 'onbekend',
        gtinChanged: o.gtinChanged ?? false,
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
      verifiedOffers: out.reduce((n, p) => n + p.verifiedOffers, 0),
    },
  };
}
