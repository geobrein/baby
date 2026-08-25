#!/usr/bin/env node
/** Schrijft een korte samenvatting van de laatste prijsronde naar GITHUB_STEP_SUMMARY. */
import fs from 'node:fs';
import { paths } from './lib/paths.mjs';
import { readJson } from './lib/store.mjs';

const report = await readJson(paths.report);
if (!report) {
  console.log('Geen data/report.json gevonden.');
  process.exit(0);
}

const lines = [
  `## Prijsronde ${report.ranAt}`,
  '',
  `- Winkels: ${report.shops.join(', ')}`,
  `- Producten: ${report.productCount}`,
  `- Prijzen gevonden: ${report.offerCount}`,
  `- Zonder resultaat: ${report.problems.length}`,
];

if (report.problems.length) {
  lines.push('', '<details><summary>Niet gevonden</summary>', '');
  for (const p of report.problems) lines.push(`- \`${p.shop}\` / \`${p.product}\`: ${p.error}`);
  lines.push('', '</details>');
}

const text = `${lines.join('\n')}\n`;
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
console.log(text);
