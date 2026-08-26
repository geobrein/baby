import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diaperRows, cheapestPerBrand, comparisonSummary, availableSizes, availableBrands, defaultSize,
  monthlyCost, DIAPERS_PER_MONTH,
} from '../site/compare.mjs';

const products = [
  {
    id: 'pampers-4', name: 'Pampers Baby-Dry maat 4', brand: 'Pampers', category: 'luiers', size: '4',
    offers: [
      { shop: 'kruidvat', shopName: 'Kruidvat', url: 'https://k.test/1', price: 24.99, unitPrice: 0.25, packSize: { amount: 100, unit: 'stuk' }, inStock: true, verification: 'exact', gtin: '8006540090992' },
      { shop: 'bol', shopName: 'bol', url: 'https://b.test/1', price: 39.99, unitPrice: 0.2, packSize: { amount: 200, unit: 'stuk' }, inStock: true, verification: 'variant', gtin: '4015400636632' },
    ],
  },
  {
    id: 'kruidvat-4', name: 'Kruidvat luiers maat 4', brand: 'Kruidvat', category: 'luiers', size: '4',
    offers: [
      { shop: 'kruidvat', shopName: 'Kruidvat', url: 'https://k.test/2', price: 8.99, unitPrice: 0.18, packSize: { amount: 50, unit: 'stuk' }, inStock: false, verification: 'onbekend', gtin: null },
    ],
  },
  {
    id: 'pampers-5', name: 'Pampers Baby-Dry maat 5', brand: 'Pampers', category: 'luiers', size: '5',
    offers: [
      { shop: 'etos', shopName: 'Etos', url: 'https://e.test/1', price: 22, unitPrice: 0.3, packSize: { amount: 73, unit: 'stuk' }, inStock: true, verification: 'exact', gtin: '8006540090992' },
    ],
  },
  {
    id: 'pants-4', name: 'Pampers Pants maat 4', brand: 'Pampers', category: 'luierbroekjes', size: '4',
    offers: [
      { shop: 'etos', shopName: 'Etos', url: 'https://e.test/2', price: 20, unitPrice: 0.28, packSize: { amount: 72, unit: 'stuk' }, inStock: true, verification: 'exact', gtin: '8006540090992' },
    ],
  },
  {
    id: 'zonder-pak', name: 'Merkloos maat 4', brand: 'Merkloos', category: 'luiers', size: '4',
    offers: [
      { shop: 'bol', shopName: 'bol', url: 'https://b.test/9', price: 5, unitPrice: null, packSize: null, inStock: true, verification: 'onbekend', gtin: null },
    ],
  },
];

test('diaperRows zet alle merken in een maat op een rij, goedkoopste per stuk eerst', () => {
  const rows = diaperRows(products, { category: 'luiers', sizes: ['4'] });
  assert.deepEqual(rows.map((r) => [r.brand, r.shop, r.unitPrice]), [
    ['Kruidvat', 'kruidvat', 0.18],
    ['Pampers', 'bol', 0.2],
    ['Pampers', 'kruidvat', 0.25],
  ]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
});

test('diaperRows laat aanbiedingen zonder stukprijs weg', () => {
  const rows = diaperRows(products, { category: 'luiers', sizes: ['4'] });
  assert.ok(!rows.some((r) => r.brand === 'Merkloos'), 'zonder verpakkingsgrootte valt er niets te vergelijken');
});

test('diaperRows filtert op maat, soort, merk, voorraad en artikelnummer', () => {
  assert.equal(diaperRows(products, { category: 'luiers', sizes: ['5'] }).length, 1);
  assert.equal(diaperRows(products, { category: 'luierbroekjes', sizes: ['4'] }).length, 1);
  assert.equal(diaperRows(products, { category: 'luiers', sizes: ['4'], brands: ['Pampers'] }).length, 2);
  assert.equal(diaperRows(products, { category: 'luiers', sizes: ['4'], inStockOnly: true }).length, 2);
  const bevestigd = diaperRows(products, { category: 'luiers', sizes: ['4'], onlyExact: true });
  assert.deepEqual(bevestigd.map((r) => r.shop), ['kruidvat']);
});

test('monthlyCost rekent met 150 luiers per maand', () => {
  assert.equal(DIAPERS_PER_MONTH, 150);
  assert.equal(monthlyCost(0.2), 30);
  assert.equal(monthlyCost(null), null);
  assert.equal(diaperRows(products, { category: 'luiers', sizes: ['4'] })[0].monthly, 27);
});

test('cheapestPerBrand geeft per merk de beste aanbieding', () => {
  const rows = diaperRows(products, { category: 'luiers', sizes: ['4'] });
  const best = cheapestPerBrand(rows);
  assert.deepEqual(best.map((r) => [r.brand, r.unitPrice]), [['Kruidvat', 0.18], ['Pampers', 0.2]]);
});

test('comparisonSummary vat het verschil per maand samen', () => {
  const rows = diaperRows(products, { category: 'luiers', sizes: ['4'] });
  const summary = comparisonSummary(rows);
  assert.equal(summary.cheapest.brand, 'Kruidvat');
  assert.equal(summary.dearest.brand, 'Pampers');
  assert.equal(summary.brands, 2);
  assert.equal(summary.monthlyDifference, 10.5);
  assert.equal(comparisonSummary([]), null);
});

test('availableSizes, availableBrands en defaultSize kijken naar wat er echt is', () => {
  assert.deepEqual(availableSizes(products, 'luiers'), ['4', '5']);
  assert.deepEqual(availableBrands(products, 'luiers', ['4']), ['Kruidvat', 'Merkloos', 'Pampers']);
  assert.equal(defaultSize(products, 'luiers'), '4', 'de maat met de meeste merken');
});
