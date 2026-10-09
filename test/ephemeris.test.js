import test from 'node:test';
import assert from 'node:assert/strict';
import { stateAt, describe, lightTime, jdOf } from '../public/js/lib/ephemeris.js';
import { fixtureJson } from './helpers.js';

const ss = fixtureJson('solar-system.json');
const body = (n) => ss.bodies.find((b) => b.name === n);

test('interpolation reproduces samples and stays near the Sun–Earth distance', () => {
  const e = body('Earth'), row = e.v[10], ms = (row[0] - 2440587.5) * 864e5 - 69.2e3;
  const s = stateAt(e.v, ms);
  assert.ok(Math.abs(s.x - row[1]) < 1e-6 && Math.abs(s.y - row[2]) < 1e-6);
  const mid = stateAt(e.v, ms + 12 * 3600e3);
  assert.ok(Math.abs(Math.hypot(mid.x, mid.y, mid.z) - 1) < 0.02);
});

test('outside the sampled window there is no answer', () => {
  assert.equal(stateAt(body('Earth').v, Date.parse('1990-01-01')), null);
});

test('Voyager 1 is more than 20 light-hours away', () => {
  const v = body('Voyager 1'), e = body('Earth'), t = (v.v[30][0] - 2440587.5) * 864e5;
  const d = describe(stateAt(v.v, t), stateAt(e.v, t));
  assert.ok(d.lightSec > 20 * 3600 && d.speedKms > 16 && d.speedKms < 18);
});

test('light time formatting', () => {
  assert.equal(lightTime(30), '30.0 s');
  assert.equal(lightTime(499), '8 min 19 s');
  assert.equal(lightTime(3600 * 23 + 60 * 5, true), '23h 05m');
  assert.ok(Math.abs(jdOf(Date.parse('2000-01-01T12:00:00Z')) - 2451545) < 1e-9);
});
