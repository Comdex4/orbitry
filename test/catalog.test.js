import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrbit, purposeFromCategory, decodeCatalog, toOMM, launchGroup, publicObject, orbitShape } from '../public/js/lib/catalog.js';
import { fixtureJson } from './helpers.js';

test('orbit classes', () => {
  assert.equal(classifyOrbit(15.49, 0.0007), 'leo');      // ISS
  assert.equal(classifyOrbit(2.0056, 0.01), 'meo');       // GPS
  assert.equal(classifyOrbit(1.0027, 0.0001), 'geo');     // geostationary
  assert.equal(classifyOrbit(2.006, 0.72), 'heo');        // Molniya
});

test('ISS orbit shape is about 420 km', () => {
  const s = orbitShape(15.49, 0.0007);
  assert.ok(s.perigee > 380 && s.apogee < 460 && Math.abs(s.period - 93) < 1);
});

test('GCAT categories map to purposes', () => {
  assert.equal(purposeFromCategory('COM'), 'comms');
  assert.equal(purposeFromCategory('COM/MET-RO'), 'comms');
  assert.equal(purposeFromCategory('SIG?*'), 'military');
  assert.equal(purposeFromCategory('IMG-R'), 'earthobs');
  assert.equal(purposeFromCategory('-'), 'unknown');
  assert.equal(purposeFromCategory(undefined), 'unknown');
});

test('catalog decodes with dictionaries and builds OMM records', () => {
  const objs = decodeCatalog(fixtureJson('catalog.json'));
  const iss = objs.find((o) => o.norad === 25544);
  assert.equal(iss.orbit, 'leo');
  assert.equal(iss.purpose, 'human');
  assert.ok(iss.countryName && iss.operatorName);
  const omm = toOMM(iss);
  assert.equal(omm.NORAD_CAT_ID, 25544);
  assert.equal(omm.MEAN_MOTION, iss.mm);
  const pub = publicObject(iss);
  assert.equal(pub.orbit.class, 'Low Earth orbit');
  assert.ok(pub.orbit.epoch.endsWith('Z'));
});

test('launch groups come from the international designator', () => {
  assert.equal(launchGroup('2026-225A'), '2026-225');
  assert.equal(launchGroup(''), null);
});
