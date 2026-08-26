#!/usr/bin/env node
/**
 * Zet de artikelnummers die de winkels het eens zijn (uit data/identity.json)
 * vast in data/catalog.json. Daarna wordt elk product met een vastgelegd EAN
 * streng gecontroleerd: een winkel die een ander artikel toont, valt af.
 *
 *   node scripts/pin-gtins.mjs            laat zien wat er zou veranderen
 *   node scripts/pin-gtins.mjs --write    past data/catalog.json aan
 */
import { paths } from './lib/paths.mjs';
import { readJson, writeJson } from './lib/store.mjs';
import { normalizeGtin, displayGtin } from './lib/identity.mjs';

const write = process.argv.includes('--write');
const catalog = await readJson(paths.catalog);
const identity = await readJson(paths.identity, {});

if (!identity || !Object.keys(identity).length) {
  console.error('Geen data/identity.json gevonden. Draai eerst een echte prijsronde (npm run fetch).');
  process.exit(1);
}

let changed = 0;
for (const product of catalog.products) {
  const perShop = identity[product.id];
  if (!perShop) continue;

  const counts = new Map();
  for (const entry of Object.values(perShop)) {
    const gtin = normalizeGtin(entry.gtin);
    if (gtin) counts.set(gtin, (counts.get(gtin) ?? 0) + 1);
  }
  const agreed = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  if (!agreed.length) {
    console.log(`- ${product.id}: geen twee winkels met hetzelfde EAN, overgeslagen`);
    continue;
  }

  const current = (product.gtins ?? []).map((g) => normalizeGtin(g)).filter(Boolean);
  const [best, votes] = agreed[0];
  if (current.includes(best)) continue;

  const merged = [...new Set([...current, best])];
  product.gtins = merged.map((g) => displayGtin(g));
  changed += 1;
  console.log(`+ ${product.id}: EAN ${displayGtin(best)} (${votes} winkels)`);
}

if (!changed) {
  console.log('Niets te wijzigen.');
} else if (write) {
  await writeJson(paths.catalog, catalog);
  console.log(`\n${changed} producten bijgewerkt in data/catalog.json.`);
} else {
  console.log(`\n${changed} producten zouden bijgewerkt worden. Draai opnieuw met --write om het op te slaan.`);
}
