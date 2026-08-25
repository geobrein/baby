import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrice, parsePackSize, extractProduct, unitPrice } from '../scripts/lib/parse.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

test('parsePrice leest Nederlandse en Engelse notatie', () => {
  assert.equal(parsePrice('€ 12,99'), 12.99);
  assert.equal(parsePrice('12.99'), 12.99);
  assert.equal(parsePrice('1.234,56'), 1234.56);
  assert.equal(parsePrice('€1,234.56'), 1234.56);
  assert.equal(parsePrice('Nu voor 9,-'), 9);
  assert.equal(parsePrice(7.5), 7.5);
  assert.equal(parsePrice('geen prijs'), null);
  assert.equal(parsePrice(null), null);
});

test('parsePackSize herkent stuks, volume en gewicht', () => {
  assert.deepEqual(parsePackSize('Pampers maat 4, 160 stuks'), { amount: 160, unit: 'stuk' });
  assert.deepEqual(parsePackSize('Billendoekjes 12 x 52 doekjes'), { amount: 624, unit: 'stuk' });
  assert.deepEqual(parsePackSize('Bepanthen zalf 100 g'), { amount: 100, unit: 'g' });
  assert.deepEqual(parsePackSize('Zwitsal badschuim 400ml'), { amount: 400, unit: 'ml' });
  assert.deepEqual(parsePackSize('Wasmiddel 1,5 liter'), { amount: 1500, unit: 'ml' });
  assert.deepEqual(parsePackSize('Luierdoos 2 kg'), { amount: 2000, unit: 'g' });
});

test('parsePackSize verwart het maatnummer niet met het aantal', () => {
  assert.equal(parsePackSize('Pampers Baby-Dry maat 4 luiers'), null);
  assert.deepEqual(parsePackSize('Pampers Baby-Dry maat 4 luiers 160 stuks'), { amount: 160, unit: 'stuk' });
});

test('extractProduct leest schema.org JSON-LD', () => {
  const info = extractProduct(fixture('product-jsonld.html'), 'https://winkel.test/p/1');
  assert.equal(info.source, 'json-ld');
  assert.equal(info.title, 'Pampers Baby-Dry Maat 4 - 160 Luiers');
  assert.equal(info.price, 39.99);
  assert.equal(info.currency, 'EUR');
  assert.equal(info.inStock, true);
  assert.deepEqual(info.packSize, { amount: 160, unit: 'stuk' });
  assert.equal(info.image, 'https://example.test/img/pampers-4.jpg');
});

test('extractProduct valt terug op meta-tags', () => {
  const info = extractProduct(fixture('product-meta.html'), 'https://drogist.test/p/2');
  assert.equal(info.source, 'meta');
  assert.equal(info.price, 14.49);
  assert.equal(info.title, 'Bepanthen Baby zalf 100 g');
  assert.deepEqual(info.packSize, { amount: 100, unit: 'g' });
  assert.equal(info.inStock, true);
});

test('extractProduct kiest de laagste offer en ziet uitverkocht', () => {
  const info = extractProduct(fixture('product-outofstock.html'), 'https://winkel.test/p/3');
  assert.equal(info.price, 5.99);
  assert.equal(info.inStock, false);
});

test('extractProduct geeft lege waarden bij onbruikbare HTML', () => {
  const info = extractProduct('<html><body>oeps</body></html>', 'https://winkel.test/x');
  assert.equal(info.price, null);
  assert.equal(info.packSize, null);
});

test('unitPrice deelt de prijs door de verpakkingsgrootte', () => {
  assert.equal(unitPrice(39.99, { amount: 160, unit: 'stuk' }), 0.2499);
  assert.equal(unitPrice(10, null), null);
  assert.equal(unitPrice(null, { amount: 10, unit: 'stuk' }), null);
});
