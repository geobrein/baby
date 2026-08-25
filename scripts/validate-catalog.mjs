#!/usr/bin/env node
/** Controleert data/catalog.json en data/shops.json zonder netwerk. */
import { paths } from './lib/paths.mjs';
import { readJson } from './lib/store.mjs';
import { validateCatalog } from './lib/validate.mjs';

const catalog = await readJson(paths.catalog);
const shops = await readJson(paths.shops);
const { errors, warnings } = validateCatalog(catalog, shops);

for (const w of warnings) console.warn(`let op: ${w}`);
for (const e of errors) console.error(`fout: ${e}`);

console.log(`${catalog?.products?.length ?? 0} producten, ${Object.keys(shops ?? {}).length} winkels gecontroleerd: ${errors.length} fouten, ${warnings.length} opmerkingen.`);
if (errors.length) process.exitCode = 1;
