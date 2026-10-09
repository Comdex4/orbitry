import test from 'node:test';
import assert from 'node:assert/strict';
import { earthOverview, siteOverview, probeOverview, longDate } from '../public/js/lib/overview.js';
import { decodeCatalog } from '../public/js/lib/catalog.js';
import { fixtureJson } from './helpers.js';

const objs = decodeCatalog(fixtureJson('catalog.json'));
const by = (n) => objs.find((o) => o.norad === n);

test('every catalog object gets an overview built from its own fields', () => {
  for (const o of objs) {
    const t = earthOverview(o);
    assert.ok(t.startsWith(o.name) && t.length > 60, t);
    assert.ok(!/undefined|null|NaN/.test(t), t);
  }
  const iss = earthOverview(by(25544));
  assert.match(iss, /human spaceflight/);
  assert.match(iss, /low Earth orbit, about 4\d\d km up/);
  assert.match(iss, /20 November 1998/);
  assert.match(earthOverview(by(41866)), /geosynchronous orbit/);
});

test('rocket bodies are not described as operated', () => {
  const rb = { ...by(25544), name: 'TEST R/B', type: 'R/B' };
  assert.doesNotMatch(earthOverview(rb), /operated by/);
});

test('Moon, Mars and probe overviews', () => {
  const moon = fixtureJson('moon.json'), a11 = moon.sites.find((s) => s.slug === 'apollo-11');
  assert.equal(siteOverview(a11, 'moon'), 'Apollo 11 (Eagle), a crewed landing on the Moon operated by NASA (USA), was launched on 16 July 1969 and reached the surface on 20 July 1969. The mission is recorded as a success.');
  assert.match(siteOverview({ ...moon.orbiters[0], kind: undefined }, 'moon'), /arrived in orbit around the Moon/);
  assert.match(probeOverview(fixtureJson('probes.json').probes[0]), /launched on 5 September 1977/);
  assert.equal(longDate('2026-10-09'), '9 October 2026');
});
