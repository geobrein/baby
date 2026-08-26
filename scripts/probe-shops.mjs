#!/usr/bin/env node
/**
 * Kijkt per winkel wat er technisch mogelijk is: wat zegt robots.txt over de
 * zoekpagina en over productpagina's, en wat geeft de winkel terug op een
 * gewone aanvraag. Schrijft niets weg; bedoeld om te bepalen langs welke weg
 * prijzen wel op te halen zijn.
 *
 *   node scripts/probe-shops.mjs [--only=bol,etos] [--url=https://...]
 */
import { Fetcher, DEFAULT_USER_AGENT } from './lib/http.mjs';
import { isAllowed, crawlDelay } from './lib/robots.mjs';
import { extractProduct } from './lib/parse.mjs';
import { extractLinks, stripTags } from './lib/html.mjs';
import { extractCandidates, loadBrowsePages } from './lib/shop.mjs';
import { scoreCandidate } from './lib/match.mjs';
import { paths } from './lib/paths.mjs';
import { readJson } from './lib/store.mjs';

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const extraUrls = argv.filter((a) => a.startsWith('--url=')).map((a) => a.slice(6));
const linkPage = argv.find((a) => a.startsWith('--links='))?.slice(8);
const candidatesFor = argv.find((a) => a.startsWith('--candidates='))?.slice(13);
const productId = argv.find((a) => a.startsWith('--product='))?.slice(10);
const linkMatch = argv.find((a) => a.startsWith('--match='))?.slice(8) ?? 'luier';

const shops = await readJson(paths.shops);
const fetcher = new Fetcher({ respectRobots: false, defaultDelayMs: 1000, maxRetries: 0, timeoutMs: 15000, log: () => {} });

// Voorbeeldpaden per winkel om robots.txt op te toetsen (het pad hoeft niet te bestaan).
const SAMPLE_PRODUCT_PATHS = {
  kruidvat: '/pampers-baby-dry-maat-4/p/123456',
  trekpleister: '/pampers-baby-dry-maat-4/p/123456',
  etos: '/pampers-baby-dry-maat-4/p/123456',
  bol: '/nl/nl/p/pampers-baby-dry-maat-4/9200000123456789/',
  babypark: '/pampers-baby-dry-maat-4.html',
  ah: '/producten/product/wi123456/pampers-baby-dry-maat-4',
  jumbo: '/producten/pampers-baby-dry-maat-4-123456',
};

console.log(`user-agent: ${DEFAULT_USER_AGENT}\n`);

for (const [id, shop] of Object.entries(shops)) {
  if (only && !only.includes(id)) continue;
  console.log(`## ${shop.name} (${shop.site})`);

  const robotsRes = await fetcher.text(`${new URL(shop.site).origin}/robots.txt`);
  if (!robotsRes.ok) {
    console.log(`   robots.txt: niet op te halen (${robotsRes.error})`);
  } else {
    const robots = robotsRes.body;
    const searchPath = new URL(shop.searchUrl.replace('{q}', 'test')).pathname
      + new URL(shop.searchUrl.replace('{q}', 'test')).search;
    const productPath = SAMPLE_PRODUCT_PATHS[id] ?? '/product/123';
    console.log(`   robots.txt: ${robots.split(/\r?\n/).length} regels, crawl-delay ${crawlDelay(robots, DEFAULT_USER_AGENT) ?? 'niet gezet'}`);
    console.log(`   zoekpagina  ${searchPath}: ${isAllowed(robots, searchPath, DEFAULT_USER_AGENT) ? 'toegestaan' : 'VERBODEN'}`);
    console.log(`   productpad  ${productPath}: ${isAllowed(robots, productPath, DEFAULT_USER_AGENT) ? 'toegestaan' : 'VERBODEN'}`);
  }

  const home = await fetcher.text(shop.site);
  console.log(`   homepage: ${home.ok ? `HTTP ${home.status}, ${home.body.length} tekens` : home.error}`);
  console.log('');
}

if (candidatesFor) {
  // Wat ziet de ophaler op de categoriepagina, en waarom past het wel of niet?
  const shop = shops[candidatesFor];
  const catalog = await readJson(paths.catalog);
  const product = productId ? catalog.products.find((p) => p.id === productId) : null;
  console.log(`## kandidaten bij ${shop.name}${product ? ` voor ${product.id}` : ''}`);

  const pages = linkPage
    ? [await fetcher.text(linkPage)].filter((r) => r.ok)
    : await loadBrowsePages(fetcher, shop, new Map());
  console.log(`   ${pages.length} pagina('s) opgehaald`);

  const candidates = pages.flatMap((page) => extractCandidates(page.body, shop, page.url));
  console.log(`   ${candidates.length} productlinks herkend\n`);

  for (const candidate of candidates.slice(0, 25)) {
    const verdict = product ? scoreCandidate(candidate.title, product) : null;
    const mark = verdict ? (verdict.ok ? `PAST (${verdict.score})` : verdict.reason) : '';
    console.log(`   ${candidate.title}`);
    console.log(`      ${candidate.url}${mark ? ` -> ${mark}` : ''}`);
  }

  if (product) {
    const passing = candidates.filter((c) => scoreCandidate(c.title, product).ok);
    console.log(`\n   ${passing.length} van ${candidates.length} kandidaten past bij ${product.id}`);
  }
  console.log('');
}

if (linkPage && !candidatesFor) {
  // Zoeken mag vaak niet, bladeren wel: welke categoriepagina's biedt de winkel aan?
  console.log(`## links op ${linkPage} die "${linkMatch}" bevatten`);
  const res = await fetcher.text(linkPage);
  if (!res.ok) {
    console.log(`   ${res.error}\n`);
  } else {
    const robots = await fetcher.text(`${new URL(linkPage).origin}/robots.txt`);
    const needle = linkMatch.toLowerCase();
    const links = [...new Set(extractLinks(res.body)
      .map((href) => {
        try {
          return new URL(href, res.url).href;
        } catch {
          return null;
        }
      })
      .filter((href) => href && href.toLowerCase().includes(needle)))];
    for (const href of links.slice(0, 40)) {
      const path = new URL(href).pathname + new URL(href).search;
      const allowed = robots.ok ? isAllowed(robots.body, path, DEFAULT_USER_AGENT) : true;
      console.log(`   ${allowed ? 'toegestaan' : 'VERBODEN  '} ${href}`);
    }
    console.log(`   (${links.length} gevonden, ${res.body.length} tekens op de pagina)\n`);
  }
}

for (const url of extraUrls) {
  console.log(`## losse pagina ${url}`);
  const res = await fetcher.text(url);
  if (!res.ok) {
    console.log(`   ${res.error}\n`);
    continue;
  }
  const info = extractProduct(res.body, res.url);
  console.log(`   HTTP ${res.status}, bron: ${info.source ?? 'geen productdata'}`);
  console.log(`   titel: ${info.title ?? '-'}`);
  console.log(`   prijs: ${info.price ?? '-'} ${info.currency}`);
  console.log(`   EAN:   ${info.gtin ?? '-'} | SKU: ${info.sku ?? '-'}`);
  console.log(`   verpakking: ${info.packSize ? `${info.packSize.amount} ${info.packSize.unit}` : '-'}\n`);
}
