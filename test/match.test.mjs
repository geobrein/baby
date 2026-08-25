import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, hasSize, scoreCandidate, bestCandidate } from '../scripts/lib/match.mjs';

const babyDry4 = {
  id: 'pampers-baby-dry-4',
  name: 'Pampers Baby-Dry maat 4',
  brand: 'Pampers',
  size: '4',
  query: 'Pampers Baby-Dry maat 4 luiers',
  match: { must: ['pampers', 'dry'], none: ['pants', 'broekjes'] },
};

test('normalize verwijdert accenten en leestekens', () => {
  assert.equal(normalize('Crème Bébé, 100 g!'), 'creme bebe 100 g');
  assert.equal(normalize('Baby-Dry'), 'baby dry');
});

test('hasSize herkent maataanduidingen', () => {
  assert.equal(hasSize('Pampers Baby-Dry Maat 4 - 160 luiers', '4'), true);
  assert.equal(hasSize('Pampers Baby-Dry size 04', '4'), true);
  assert.equal(hasSize('Pampers Baby-Dry maat 5', '4'), false);
  assert.equal(hasSize('Bepanthen zalf', null), true);
});

test('scoreCandidate wijst verkeerde maat, merk en variant af', () => {
  assert.equal(scoreCandidate('Pampers Baby-Dry Maat 4 - 160 Luiers', babyDry4).ok, true);
  assert.equal(scoreCandidate('Pampers Baby-Dry Pants maat 4', babyDry4).ok, false);
  assert.equal(scoreCandidate('Pampers Baby-Dry maat 5 luiers', babyDry4).ok, false);
  assert.equal(scoreCandidate('Huggies maat 4', babyDry4).ok, false);
  assert.equal(scoreCandidate('', babyDry4).ok, false);
});

test('scoreCandidate controleert de gevraagde verpakkingsgrootte', () => {
  const bepanthen30 = {
    id: 'bepanthen-30', name: 'Bepanthen 30 g', brand: 'Bepanthen',
    query: 'Bepanthen baby zalf 30 gram', match: { must: ['bepanthen'], packSize: 30 },
  };
  assert.equal(scoreCandidate('Bepanthen Baby Zalf 30 g', bepanthen30).ok, true);
  assert.equal(scoreCandidate('Bepanthen Baby Zalf 100 g', bepanthen30).ok, false);
});

test('bestCandidate kiest het meest specifieke resultaat', () => {
  const winner = bestCandidate([
    { title: 'Pampers Baby-Dry Pants maat 4', url: 'https://x.test/1' },
    { title: 'Pampers Baby-Dry maat 4 luiers 160 stuks voordeelverpakking extra groot', url: 'https://x.test/2' },
    { title: 'Pampers Baby-Dry maat 4 luiers', url: 'https://x.test/3' },
  ], babyDry4);
  assert.equal(winner.url, 'https://x.test/3');
});

test('bestCandidate geeft null als niets past', () => {
  assert.equal(bestCandidate([{ title: 'Huggies maat 4', url: 'https://x.test/1' }], babyDry4), null);
});
