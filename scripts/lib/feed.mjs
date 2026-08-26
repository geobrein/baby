/**
 * Productfeeds lezen (CSV/TSV en XML) zoals affiliatenetwerken en het bol
 * Partnerprogramma die aanbieden: prijs, voorraad, EAN en een deeplink.
 *
 * Feeds zijn vaak honderden megabytes, dus alles gaat streamend: de rijen
 * komen er een voor een uit en alleen wat bij de catalogus past wordt bewaard.
 */
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { decodeEntities, stripTags } from './html.mjs';
import { parsePrice, parsePackSize } from './parse.mjs';
import { normalizeGtin } from './identity.mjs';
import { scoreCandidate } from './match.mjs';

/** Veldnamen zoals ze in de gangbare feeds voorkomen (Awin, Daisycon, TradeTracker, Google Shopping). */
export const DEFAULT_MAPPING = {
  gtin: ['ean', 'gtin', 'gtin13', 'barcode', 'g:gtin', 'product_ean', 'ean_code'],
  sku: ['sku', 'merchant_product_id', 'product_id', 'id', 'g:id', 'artikelnummer'],
  title: ['name', 'title', 'product_name', 'productname', 'g:title', 'merchant_product_name'],
  brand: ['brand', 'merk', 'g:brand', 'manufacturer'],
  price: ['price', 'search_price', 'sale_price', 'g:price', 'prijs', 'store_price', 'display_price'],
  currency: ['currency', 'g:price_currency', 'valuta'],
  url: ['aw_deep_link', 'deeplink', 'deep_link', 'product_url', 'link', 'url', 'g:link', 'merchant_deep_link'],
  stock: ['in_stock', 'stock_status', 'availability', 'g:availability', 'voorraad', 'stock_quantity'],
  size: ['size', 'g:size', 'maat', 'unit', 'content_size'],
};

const IN_STOCK = /^(1|true|ja|yes|y|in ?stock|op ?voorraad|available|beschikbaar|leverbaar)$/i;
const OUT_OF_STOCK = /^(0|false|nee|no|n|out ?of ?stock|niet ?op ?voorraad|uitverkocht|unavailable|sold ?out)$/i;

/** Pakt de eerste gevulde waarde uit een rij, gegeven een lijst mogelijke veldnamen. */
export function pick(row, names) {
  for (const name of names) {
    for (const key of [name, name.toLowerCase(), name.replace(/^g:/, '')]) {
      const value = row[key];
      if (value != null && String(value).trim() !== '') return String(value).trim();
    }
  }
  return null;
}

/** Zet een ruwe feedrij om in dezelfde vorm als een aanbieding van een productpagina. */
export function normalizeRow(row, mapping = DEFAULT_MAPPING) {
  const map = { ...DEFAULT_MAPPING, ...mapping };
  const title = decodeEntities(stripTags(pick(row, map.title) ?? ''));
  const stock = pick(row, map.stock);
  const priceText = pick(row, map.price);
  const sizeText = pick(row, map.size);

  return {
    gtin: normalizeGtin(pick(row, map.gtin)),
    sku: pick(row, map.sku),
    title: title || null,
    brand: pick(row, map.brand),
    price: parsePrice(priceText),
    currency: (pick(row, map.currency) ?? 'EUR').toUpperCase().slice(0, 3),
    url: pick(row, map.url),
    inStock: stock == null ? null : (IN_STOCK.test(stock) ? true : (OUT_OF_STOCK.test(stock) ? false : null)),
    packSize: parsePackSize(sizeText) ?? parsePackSize(title),
  };
}

/* ---------- CSV ---------- */

/** Raadt het scheidingsteken op basis van de kopregel. */
export function sniffDelimiter(headerLine = '') {
  const counts = [',', ';', '\t', '|'].map((d) => [d, headerLine.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/**
 * Leest CSV/TSV karakter voor karakter, zodat aanhalingstekens met daarin
 * scheidingstekens of regeleindes goed gaan.
 */
export function* parseCsvRecords(text, delimiter) {
  let field = '';
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      if (record.some((f) => f !== '')) yield record;
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  record.push(field);
  if (record.some((f) => f !== '')) yield record;
}

/** CSV-tekst naar objecten, met de eerste regel als kop. */
export function parseCsv(text, delimiter) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const sep = delimiter ?? sniffDelimiter(firstLine);
  const records = [...parseCsvRecords(text, sep)];
  if (!records.length) return [];
  const header = records[0].map((h) => h.trim().replace(/^\uFEFF/, '').toLowerCase());
  return records.slice(1).map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ''])));
}

/* ---------- XML ---------- */

const ITEM_TAGS = ['item', 'product', 'entry', 'offer'];

/** Haalt de losse velden uit een XML-item; naamruimtes en CDATA worden weggewerkt. */
export function parseXmlItem(xml) {
  const row = {};
  const re = /<([a-z0-9_:.-]+)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const key = m[1].toLowerCase().replace(/^[a-z0-9_-]+:/, '');
    let value = m[3];
    if (/<[a-z]/i.test(value)) continue; // geneste structuur, geen simpel veld
    value = decodeEntities(value.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')).trim();
    if (value && row[key] == null) row[key] = value;
  }
  return row;
}

/** Alle items uit een XML-tekst. */
export function parseXmlFeed(text) {
  for (const tag of ITEM_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    const items = [...text.matchAll(re)].map((m) => parseXmlItem(m[1]));
    if (items.length) return items;
  }
  return [];
}

/* ---------- Streamen vanaf schijf ---------- */

/**
 * Leest een feedbestand rij voor rij.
 * @param {string} filePath
 * @param {{format?: 'csv'|'xml'|'auto', delimiter?: string}} options
 */
export async function* streamFeedRows(filePath, { format = 'auto', delimiter } = {}) {
  const kind = format === 'auto' ? await sniffFormat(filePath) : format;
  if (kind === 'xml') {
    yield* streamXmlRows(filePath);
    return;
  }
  yield* streamCsvRows(filePath, delimiter);
}

async function sniffFormat(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(512), 0, 512, 0);
    return /^\s*<\?xml|<rss|<products|<item\b/i.test(buffer.toString('utf8')) ? 'xml' : 'csv';
  } finally {
    await handle.close();
  }
}

async function* streamCsvRows(filePath, delimiter) {
  // Regelgebaseerd lezen is snel; velden met een regeleinde erin worden
  // opgevangen doordat een onvolledige regel bij de volgende wordt geplakt.
  const input = createInterface({ input: fs.createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  let header = null;
  let sep = delimiter;
  let pending = '';
  for await (const line of input) {
    const text = pending ? `${pending}\n${line}` : line;
    if ((text.match(/"/g)?.length ?? 0) % 2 === 1) {
      pending = text;
      continue;
    }
    pending = '';
    sep ??= sniffDelimiter(text);
    const [record] = [...parseCsvRecords(text, sep)];
    if (!record) continue;
    if (!header) {
      header = record.map((h) => h.trim().replace(/^\uFEFF/, '').toLowerCase());
      continue;
    }
    yield Object.fromEntries(header.map((key, i) => [key, record[i] ?? '']));
  }
}

async function* streamXmlRows(filePath) {
  const stream = fs.createReadStream(filePath, 'utf8');
  let buffer = '';
  let tag = null;
  for await (const chunk of stream) {
    buffer += chunk;
    tag ??= ITEM_TAGS.find((t) => new RegExp(`<${t}\\b`, 'i').test(buffer)) ?? null;
    if (!tag) {
      if (buffer.length > 1_000_000) buffer = buffer.slice(-100_000);
      continue;
    }
    const close = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let last = 0;
    let m;
    while ((m = close.exec(buffer)) !== null) {
      yield parseXmlItem(m[1]);
      last = close.lastIndex;
    }
    if (last) buffer = buffer.slice(last);
  }
}

/* ---------- Koppelen aan de catalogus ---------- */

/**
 * Zoekt in de feedrijen de beste treffer per catalogusproduct.
 * EAN gaat voor; anders wordt op titel gematcht met dezelfde regels als bij het scrapen.
 * Werkt met een gewone lijst en met een stroom rijen.
 * @returns {Promise<Map<string, object>>} productId -> { row, score }
 */
export async function matchFeedToProducts(rows, products, mapping) {
  const state = createMatcher(products, mapping);
  for await (const raw of rows) state.add(raw);
  return state.best;
}

/** Synchrone variant voor een lijst die al in het geheugen zit. */
export function matchRowsToProducts(rows, products, mapping) {
  const wantedGtins = new Map();
  for (const product of products) {
    for (const gtin of product.gtins ?? []) {
      const normalized = normalizeGtin(gtin);
      if (normalized) wantedGtins.set(normalized, product.id);
    }
  }

  const state = createMatcher(products, mapping);
  for (const raw of rows) state.add(raw);
  return state.best;
}

function createMatcher(products, mapping) {
  const wantedGtins = new Map();
  for (const product of products) {
    for (const gtin of product.gtins ?? []) {
      const normalized = normalizeGtin(gtin);
      if (normalized) wantedGtins.set(normalized, product.id);
    }
  }
  const best = new Map();

  return {
    best,
    add(raw) {
      const row = normalizeRow(raw, mapping);
      if (row.price == null || !row.url) return;

      const byGtin = row.gtin ? wantedGtins.get(row.gtin) : null;
      if (byGtin) {
        keepBest(best, byGtin, row, 100);
        return;
      }
      for (const product of products) {
        // Producten met een vastgelegd EAN worden alleen daarop gematcht.
        if (product.gtins?.length) continue;
        const verdict = scoreCandidate(row.title, product);
        if (verdict.ok) keepBest(best, product.id, row, verdict.score);
      }
    },
  };
}

/** Haalt een feed op en zet hem op schijf; feeds zijn te groot voor het geheugen. */
export async function downloadFeed(url, filePath, { userAgent, timeoutMs = 120000, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': userAgent ?? 'BabyprijsBot/1.0', accept: 'text/csv,application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`feed niet op te halen: HTTP ${res.status}`);
  await fs.promises.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
  const { size } = await fs.promises.stat(filePath);
  return { bytes: size };
}

function keepBest(best, productId, row, score) {
  const current = best.get(productId);
  if (!current || score > current.score || (score === current.score && row.price < current.row.price)) {
    best.set(productId, { row, score });
  }
}
