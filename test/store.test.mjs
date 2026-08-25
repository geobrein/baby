import test from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory, lowestInPeriod } from '../scripts/lib/store.mjs';

test('appendHistory voegt een dag toe en overschrijft dezelfde dag', () => {
  const history = {};
  appendHistory(history, 'p1', 'kruidvat', '2026-08-24', 10, 0.2);
  appendHistory(history, 'p1', 'kruidvat', '2026-08-25', 9, 0.18);
  appendHistory(history, 'p1', 'kruidvat', '2026-08-25', 8.5, 0.17);
  assert.deepEqual(history.p1.kruidvat, [
    { d: '2026-08-24', p: 10, u: 0.2 },
    { d: '2026-08-25', p: 8.5, u: 0.17 },
  ]);
});

test('appendHistory bewaart maximaal het ingestelde aantal dagen', () => {
  const history = {};
  for (let i = 1; i <= 10; i += 1) {
    appendHistory(history, 'p1', 'etos', `2026-08-${String(i).padStart(2, '0')}`, i, null, 5);
  }
  assert.equal(history.p1.etos.length, 5);
  assert.equal(history.p1.etos[0].d, '2026-08-06');
});

test('lowestInPeriod kijkt over winkels heen binnen de periode', () => {
  const today = new Date('2026-08-25T12:00:00Z');
  const history = {
    p1: {
      kruidvat: [{ d: '2026-08-20', p: 12, u: null }, { d: '2026-08-25', p: 11, u: null }],
      etos: [{ d: '2026-06-01', p: 4, u: null }, { d: '2026-08-22', p: 9.5, u: null }],
    },
  };
  assert.equal(lowestInPeriod(history, 'p1', 30, today), 9.5);
  assert.equal(lowestInPeriod(history, 'onbekend', 30, today), null);
});
