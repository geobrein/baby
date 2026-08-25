/** Bepaalt of een zoekresultaat echt het gevraagde product is. */
import { parsePackSize } from './parse.mjs';

export function normalize(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Staat er "maat 4" (of size/mt/t 4) in de titel? */
export function hasSize(title, size) {
  if (!size) return true;
  const n = normalize(title);
  const s = String(size).toLowerCase().replace(/\s/g, '');
  const num = s.replace(/^0+/, '');
  const patterns = [
    new RegExp(`\\b(?:maat|maten|size|mt|nr)\\s*0*${num}\\b`),
    new RegExp(`\\bs${num}\\b`),
    new RegExp(`\\bt${num}\\b`),
  ];
  return patterns.some((re) => re.test(n));
}

/**
 * Beoordeelt een kandidaat-titel voor een catalogusproduct.
 * Geeft { ok, score, reason } terug; hogere score = betere match.
 */
export function scoreCandidate(title, product) {
  if (!title) return { ok: false, score: 0, reason: 'geen titel' };
  const n = normalize(title);
  const rules = product.match ?? {};

  for (const token of rules.must ?? []) {
    if (!n.includes(normalize(token))) return { ok: false, score: 0, reason: `mist "${token}"` };
  }
  for (const token of rules.none ?? []) {
    if (n.includes(normalize(token))) return { ok: false, score: 0, reason: `bevat "${token}"` };
  }
  if (product.brand && !n.includes(normalize(product.brand))) {
    return { ok: false, score: 0, reason: `merk "${product.brand}" niet in titel` };
  }
  if (product.size && !hasSize(title, product.size)) {
    return { ok: false, score: 0, reason: `maat ${product.size} niet in titel` };
  }
  if (rules.packSize) {
    const pack = parsePackSize(title);
    if (!pack || Math.abs(pack.amount - rules.packSize) > 0.01) {
      return { ok: false, score: 0, reason: `verpakking ${rules.packSize} niet herkend` };
    }
  }

  // Score: overlap met de zoekterm, plus bonus voor een korte, exacte titel.
  const queryTokens = new Set(normalize(product.query ?? product.name).split(' ').filter(Boolean));
  const titleTokens = new Set(n.split(' ').filter(Boolean));
  let overlap = 0;
  for (const t of queryTokens) if (titleTokens.has(t)) overlap += 1;
  const coverage = queryTokens.size ? overlap / queryTokens.size : 0;
  const brevity = 1 / (1 + Math.max(0, titleTokens.size - queryTokens.size) / 10);
  return { ok: true, score: Number((coverage * 10 + brevity).toFixed(4)), reason: 'ok' };
}

/** Kiest het beste zoekresultaat uit [{title, url}, ...]. */
export function bestCandidate(candidates, product) {
  const scored = candidates
    .map((c) => ({ ...c, ...scoreCandidate(c.title, product) }))
    .filter((c) => c.ok)
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}
