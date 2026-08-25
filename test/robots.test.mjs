import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed, crawlDelay, parseRobots } from '../scripts/lib/robots.mjs';

const ROBOTS = [
  'User-agent: *',
  'Disallow: /checkout',
  'Allow: /checkout/informatie',
  'Disallow: /*?sort=',
  'Crawl-delay: 2',
  '',
  'User-agent: BabyprijsBot',
  'Disallow: /prive',
].join('\n');

test('parseRobots groepeert per user-agent', () => {
  const groups = parseRobots(ROBOTS);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[1].agents, ['babyprijsbot']);
});

test('isAllowed volgt de langste passende regel', () => {
  assert.equal(isAllowed(ROBOTS, '/product/p/1', 'AndereBot'), true);
  assert.equal(isAllowed(ROBOTS, '/checkout/betalen', 'AndereBot'), false);
  assert.equal(isAllowed(ROBOTS, '/checkout/informatie', 'AndereBot'), true);
  assert.equal(isAllowed(ROBOTS, '/zoeken?sort=prijs', 'AndereBot'), false);
});

test('een eigen user-agent-groep gaat voor de wildcard', () => {
  assert.equal(isAllowed(ROBOTS, '/prive', 'BabyprijsBot/1.0'), false);
  assert.equal(isAllowed(ROBOTS, '/checkout/betalen', 'BabyprijsBot/1.0'), true);
});

test('lege of ontbrekende robots.txt staat alles toe', () => {
  assert.equal(isAllowed('', '/wat-dan-ook', 'BabyprijsBot'), true);
  assert.equal(crawlDelay('', 'BabyprijsBot'), null);
});

test('crawlDelay wordt gelezen', () => {
  assert.equal(crawlDelay(ROBOTS, 'AndereBot'), 2);
});
