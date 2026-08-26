import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseCsv, sniffDelimiter, parseXmlFeed, parseXmlItem, normalizeRow, pick,
  matchRowsToProducts, matchFeedToProducts, streamFeedRows, DEFAULT_MAPPING,
} from '../scripts/lib/feed.mjs';
import { collectFeedOffers } from '../scripts/lib/feed-run.mjs';

const PRODUCTS = [
  {
    id: 'pampers-baby-dry-4',
    name: 'Pampers Baby-Dry maat 4',
    brand: 'Pampers',
    category: 'luiers',
    size: '4',
    unit: 'stuk',
    query: 'Pampers Baby-Dry maat 4 luiers',
    match: { must: ['pampers', 'dry'], none: ['pants'] },
  },
  {
    id: 'bepanthen-30',
    name: 'Bepanthen Baby zalf 30 g',
    brand: 'Bepanthen',
    category: 'verzorging',
    unit: 'g',
    gtins: ['4015400636632'],
    query: 'Bepanthen baby zalf 30 gram',
    match: { must: ['bepanthen'] },
  },
];

const CSV = [
  'merchant_product_id;name;brand;search_price;currency;ean;aw_deep_link;in_stock',
  '111;Pampers Baby-Dry maat 4 luiers 160 stuks;Pampers;39,99;EUR;8006540090992;https://winkel.test/p/111;1',
  '112;"Pampers Baby-Dry Pants maat 4, 114 stuks";Pampers;41,99;EUR;8006540090993;https://winkel.test/p/112;1',
  '113;Iets heel anders;Zwitsal;3,49;EUR;;https://winkel.test/p/113;0',
  '114;Bepanthen Baby Zalf 30 g;Bepanthen;9,49;EUR;4015400636632;https://winkel.test/p/114;ja',
].join('\n');

const XML = `<?xml version="1.0"?>
<products>
  <product>
    <id>221</id>
    <title><![CDATA[Pampers Baby-Dry maat 4 luiers 160 stuks]]></title>
    <g:brand>Pampers</g:brand>
    <g:price>37.49 EUR</g:price>
    <gtin>8006540090992</gtin>
    <link>https://winkel.test/p/221</link>
    <g:availability>in stock</g:availability>
  </product>
  <product>
    <id>222</id>
    <title>Bepanthen Baby Zalf 30 g</title>
    <g:price>8.99</g:price>
    <gtin>4015400636632</gtin>
    <link>https://winkel.test/p/222</link>
    <g:availability>out of stock</g:availability>
  </product>
</products>`;

test('sniffDelimiter herkent puntkomma, tab en komma', () => {
  assert.equal(sniffDelimiter('a;b;c'), ';');
  assert.equal(sniffDelimiter('a\tb\tc'), '\t');
  assert.equal(sniffDelimiter('a,b,c'), ',');
});

test('parseCsv leest velden met aanhalingstekens en scheidingstekens erin', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].name, 'Pampers Baby-Dry Pants maat 4, 114 stuks');
  assert.equal(rows[0].ean, '8006540090992');
});

test('pick en normalizeRow snappen de gangbare veldnamen', () => {
  const [row] = parseCsv(CSV);
  assert.equal(pick(row, DEFAULT_MAPPING.price), '39,99');
  const norm = normalizeRow(row);
  assert.equal(norm.price, 39.99);
  assert.equal(norm.gtin, '08006540090992');
  assert.equal(norm.url, 'https://winkel.test/p/111');
  assert.equal(norm.inStock, true);
  assert.deepEqual(norm.packSize, { amount: 160, unit: 'stuk' });
});

test('normalizeRow leest voorraad in het Nederlands en Engels', () => {
  assert.equal(normalizeRow({ name: 'x', price: '1', link: 'u', availability: 'out of stock' }).inStock, false);
  assert.equal(normalizeRow({ name: 'x', price: '1', link: 'u', voorraad: 'ja' }).inStock, true);
  assert.equal(normalizeRow({ name: 'x', price: '1', link: 'u' }).inStock, null);
});

test('parseXmlItem werkt CDATA en naamruimtes weg', () => {
  const row = parseXmlItem('<title><![CDATA[Luier &amp; co]]></title><g:price>3.50</g:price>');
  assert.equal(row.title, 'Luier & co');
  assert.equal(row.price, '3.50');
});

test('parseXmlFeed leest een productfeed', () => {
  const rows = parseXmlFeed(XML);
  assert.equal(rows.length, 2);
  const norm = normalizeRow(rows[0]);
  assert.equal(norm.price, 37.49);
  assert.equal(norm.inStock, true);
  assert.equal(norm.gtin, '08006540090992');
});

test('matchRowsToProducts koppelt op EAN en anders op titel', () => {
  const best = matchRowsToProducts(parseCsv(CSV), PRODUCTS);
  assert.equal(best.size, 2);
  assert.equal(best.get('pampers-baby-dry-4').row.url, 'https://winkel.test/p/111');
  assert.equal(best.get('bepanthen-30').row.price, 9.49);
});

test('een product met vastgelegd EAN pakt geen ander artikel op naam', () => {
  const rows = parseCsv([
    'name;price;ean;link',
    'Bepanthen Baby Zalf 100 g;14,99;8006540090992;https://winkel.test/p/9',
  ].join('\n'));
  const best = matchRowsToProducts(rows, PRODUCTS);
  assert.equal(best.has('bepanthen-30'), false);
});

test('de luierbroekjes-variant wordt niet als luier meegeteld', () => {
  const best = matchRowsToProducts(parseCsv(CSV), PRODUCTS);
  assert.notEqual(best.get('pampers-baby-dry-4').row.url, 'https://winkel.test/p/112');
});

test('streamFeedRows leest csv en xml van schijf', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedtest-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const csvFile = path.join(dir, 'feed.csv');
  const xmlFile = path.join(dir, 'feed.xml');
  await fs.writeFile(csvFile, CSV);
  await fs.writeFile(xmlFile, XML);

  const csvRows = [];
  for await (const row of streamFeedRows(csvFile)) csvRows.push(row);
  assert.equal(csvRows.length, 4);
  assert.equal(csvRows[3].name, 'Bepanthen Baby Zalf 30 g');

  const xmlRows = [];
  for await (const row of streamFeedRows(xmlFile)) xmlRows.push(row);
  assert.equal(xmlRows.length, 2);

  const best = await matchFeedToProducts(streamFeedRows(xmlFile), PRODUCTS);
  assert.equal(best.get('pampers-baby-dry-4').row.price, 37.49);
});

test('collectFeedOffers slaat feeds zonder secret over', async () => {
  const logs = [];
  const { offers, used } = await collectFeedOffers({
    feeds: [{ id: 'x', shop: 'bol', name: 'Test', urlEnv: 'FEED_TEST_URL' }],
    shops: { bol: { name: 'bol' } },
    products: PRODUCTS,
    env: {},
    log: (m) => logs.push(m),
  });
  assert.equal(offers.size, 0);
  assert.equal(used.length, 0);
  assert.match(logs.join('\n'), /FEED_TEST_URL is niet ingesteld/);
});

test('collectFeedOffers maakt aanbiedingen met stukprijs', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedrun-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { offers, used, problems } = await collectFeedOffers({
    feeds: [{ id: 'test', shop: 'bol', name: 'Testfeed', urlEnv: 'FEED_TEST_URL' }],
    shops: { bol: { name: 'bol' } },
    products: PRODUCTS,
    env: { FEED_TEST_URL: 'https://feed.test/products.csv' },
    log: () => {},
    download: async (url, filePath) => {
      await fs.writeFile(filePath, CSV);
      return { bytes: CSV.length };
    },
  });

  assert.deepEqual(problems, []);
  assert.equal(used[0].matched, 2);
  const [offer] = offers.get('pampers-baby-dry-4');
  assert.equal(offer.shop, 'bol');
  assert.equal(offer.price, 39.99);
  assert.equal(offer.source, 'feed');
  assert.equal(offer.unitPrice, 0.2499);
  assert.equal(offer.unitLabel, 'per stuk');
  assert.equal(offer.gtin, '08006540090992');
});

test('een kapotte feed stopt de ronde niet', async () => {
  const { offers, problems } = await collectFeedOffers({
    feeds: [{ id: 'stuk', shop: 'bol', name: 'Kapot', urlEnv: 'FEED_TEST_URL' }],
    shops: { bol: { name: 'bol' } },
    products: PRODUCTS,
    env: { FEED_TEST_URL: 'https://feed.test/kapot.csv' },
    log: () => {},
    download: async () => { throw new Error('feed niet op te halen: HTTP 500'); },
  });
  assert.equal(offers.size, 0);
  assert.match(problems[0].error, /HTTP 500/);
});
