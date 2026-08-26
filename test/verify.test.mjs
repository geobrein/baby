import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOffers, recordIdentity, EXACT, VARIANT, MISMATCH, UNKNOWN } from '../scripts/lib/verify.mjs';

const PAMPERS = '8006540090992';
const ANDERE = '4015400636632';

const product = { id: 'pampers-baby-dry-4', name: 'Pampers Baby-Dry maat 4' };

const offer = (shop, gtin, extra = {}) => ({ shop, shopName: shop, gtin, price: 10, ...extra });

test('twee winkels met hetzelfde EAN vormen de referentie', () => {
  const result = verifyOffers(product, [
    offer('kruidvat', PAMPERS),
    offer('etos', PAMPERS),
    offer('bol', ANDERE),
    offer('babypark', null),
  ]);
  assert.equal(result.referenceSource, 'consensus');
  assert.deepEqual(result.offers.map((o) => o.verification), [EXACT, EXACT, VARIANT, UNKNOWN]);
  assert.equal(result.offers[0].gtinDisplay, PAMPERS);
});

test('zonder tweede winkel valt er niets te bevestigen', () => {
  const result = verifyOffers(product, [offer('kruidvat', PAMPERS), offer('etos', null)]);
  assert.equal(result.reference, null);
  assert.deepEqual(result.offers.map((o) => o.verification), [UNKNOWN, UNKNOWN]);
});

test('twee winkels die elkaar tegenspreken leveren beide een variant op', () => {
  const result = verifyOffers(product, [offer('kruidvat', PAMPERS), offer('etos', ANDERE)]);
  assert.deepEqual(result.offers.map((o) => o.verification), [VARIANT, VARIANT]);
});

test('een EAN-lijst in de catalogus is leidend en gooit afwijkende artikelen eruit', () => {
  const strikt = { ...product, gtins: [PAMPERS] };
  const result = verifyOffers(strikt, [offer('kruidvat', PAMPERS), offer('etos', ANDERE)]);
  assert.equal(result.referenceSource, 'catalogus');
  assert.equal(result.strict, true);
  assert.equal(result.offers.length, 1, 'het afwijkende artikel valt af');
  assert.equal(result.offers[0].shop, 'kruidvat');
  assert.ok(result.issues.some((i) => i.type === 'gtin-niet-in-catalogus'));
});

test('met strictGtin false blijft een afwijkend artikel staan, wel gemarkeerd', () => {
  const soepel = { ...product, gtins: [PAMPERS], strictGtin: false };
  const result = verifyOffers(soepel, [offer('kruidvat', PAMPERS), offer('etos', ANDERE)]);
  assert.equal(result.offers.length, 2);
  assert.deepEqual(result.offers.map((o) => o.verification), [EXACT, MISMATCH]);
});

test('een gewijzigd EAN bij dezelfde winkel wordt gemeld', () => {
  const result = verifyOffers(product, [offer('kruidvat', ANDERE), offer('etos', ANDERE)], {
    kruidvat: { gtin: PAMPERS },
  });
  assert.equal(result.offers[0].gtinChanged, true);
  const issue = result.issues.find((i) => i.type === 'gtin-gewijzigd');
  assert.ok(issue);
  assert.match(issue.message, /mogelijk een ander artikel/);
});

test('zelfde EAN met een andere verpakkingsgrootte is verdacht', () => {
  const result = verifyOffers(product, [
    offer('kruidvat', PAMPERS, { packSize: { amount: 160, unit: 'stuk' } }),
    offer('etos', PAMPERS, { packSize: { amount: 82, unit: 'stuk' } }),
  ]);
  assert.ok(result.issues.some((i) => i.type === 'verpakking-wijkt-af'));
});

test('recordIdentity houdt wijzigingen bij', () => {
  const identity = {};
  const now = new Date('2026-08-25T10:00:00Z');
  recordIdentity(identity, product.id, [{ shop: 'kruidvat', gtin: PAMPERS, sku: 'A1' }], now);
  recordIdentity(identity, product.id, [{ shop: 'kruidvat', gtin: ANDERE, sku: 'A2' }], new Date('2026-08-26T10:00:00Z'));
  const entry = identity[product.id].kruidvat;
  assert.equal(entry.gtin, ANDERE);
  assert.equal(entry.sku, 'A2');
  assert.equal(entry.changes.length, 1);
  assert.deepEqual(entry.changes[0].from, PAMPERS);
});
