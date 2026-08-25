/** Lezen en schrijven van de JSON-bestanden in data/. */
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Kan ${file} niet lezen: ${err.message}`);
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Voegt de prijs van vandaag toe aan de historie en bewaart maximaal `keepDays` punten. */
export function appendHistory(history, productId, shopId, date, price, unitPriceValue, keepDays = 90) {
  const perProduct = (history[productId] ??= {});
  const series = (perProduct[shopId] ??= []);
  const last = series[series.length - 1];
  if (last && last.d === date) {
    last.p = price;
    last.u = unitPriceValue ?? null;
  } else {
    series.push({ d: date, p: price, u: unitPriceValue ?? null });
  }
  if (series.length > keepDays) series.splice(0, series.length - keepDays);
  return history;
}

/** Laagste geregistreerde prijs binnen `days` dagen, over alle winkels heen. */
export function lowestInPeriod(history, productId, days = 30, today = new Date()) {
  const cutoff = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  let lowest = null;
  for (const series of Object.values(history[productId] ?? {})) {
    for (const point of series) {
      if (point.d < cutoff || typeof point.p !== 'number') continue;
      if (lowest == null || point.p < lowest) lowest = point.p;
    }
  }
  return lowest;
}
