#!/usr/bin/env node
/**
 * Haalt de dagprijzen op bij alle ingeschakelde winkels en schrijft site/data/prices.json.
 *
 *   node scripts/fetch-prices.mjs                 alle winkels, echte prijzen
 *   node scripts/fetch-prices.mjs --mock          demoprijzen zonder netwerk
 *   node scripts/fetch-prices.mjs --only=kruidvat,etos
 *   node scripts/fetch-prices.mjs --product=bepanthen-baby-zalf-30g
 *   node scripts/fetch-prices.mjs --limit=5
 */
import { parseArgs, run, HELP } from './lib/run.mjs';

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  const log = args.quiet ? () => {} : (...m) => console.log(...m);
  const { payload, problems } = await run(args, { log });
  console.log(`\nKlaar: ${payload.stats.offers} prijzen voor ${payload.stats.productsWithOffers}/${payload.stats.products} producten, ${problems.length} zonder resultaat.`);
  console.log(`Geschreven: site/data/prices.json (${payload.updatedAt})`);
} catch (err) {
  console.error(`Fout: ${err.message}`);
  process.exitCode = 1;
}
