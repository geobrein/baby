import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isValidGtin, normalizeGtin, displayGtin, sameGtin, checkDigit, extractIdentifiers, identifiersFromNode,
} from '../scripts/lib/identity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

test('isValidGtin controleert het controlecijfer', () => {
  assert.equal(isValidGtin('8006540090992'), true);
  assert.equal(isValidGtin('4015400636632'), true);
  assert.equal(isValidGtin('8006540090993'), false, 'verkeerd controlecijfer');
  assert.equal(isValidGtin('12345'), false, 'verkeerde lengte');
  assert.equal(isValidGtin('0000000000000'), false);
  assert.equal(isValidGtin(null), false);
});

test('checkDigit berekent het controlecijfer', () => {
  assert.equal(checkDigit('800654009099'), 2);
  assert.equal(`401540063663${checkDigit('401540063663')}`, '4015400636632');
});

test('normalizeGtin maakt UPC-12 en EAN-13 vergelijkbaar', () => {
  assert.equal(normalizeGtin('8006540090992'), '08006540090992');
  assert.equal(normalizeGtin('ean 8006540090992'), '08006540090992');
  assert.equal(normalizeGtin('8006540090993'), null);
  assert.equal(sameGtin('0012345678905', '012345678905'), true);
  assert.equal(sameGtin('8006540090992', '4015400636632'), false);
  assert.equal(sameGtin(null, '8006540090992'), false);
});

test('displayGtin toont een EAN-13', () => {
  assert.equal(displayGtin('08006540090992'), '8006540090992');
  assert.equal(displayGtin(null), null);
});

test('identifiersFromNode leest gtin, sku en mpn, ook uit offers', () => {
  const node = {
    '@type': 'Product',
    sku: 'ABC-1',
    offers: { '@type': 'Offer', gtin13: '8006540090992', price: '9,99' },
  };
  assert.deepEqual(identifiersFromNode(node), { gtin: '08006540090992', sku: 'ABC-1', mpn: null });
});

test('identifiersFromNode negeert een ongeldig artikelnummer', () => {
  const node = { '@type': 'Product', gtin13: '8006540090993' };
  assert.equal(identifiersFromNode(node).gtin, null);
});

test('extractIdentifiers vindt het EAN in JSON-LD en in een specificatietabel', () => {
  assert.equal(extractIdentifiers(fixture('product-jsonld.html')).gtin, '08006540090992');
  assert.equal(extractIdentifiers(fixture('product-jsonld.html')).sku, '112233');
  assert.equal(extractIdentifiers(fixture('product-meta.html')).gtin, '04015400636632');
  assert.equal(extractIdentifiers('<html></html>').gtin, null);
});
