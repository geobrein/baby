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
import { paths } from './lib/paths.mjs';
import { readJson } from './lib/store.mjs';

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const extraUrls = argv.filter((a) => a.startsWith('--url=')).map((a) => a.slice(6));

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
