import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCatalog, epochMs } from '../public/js/lib/catalog.js';
import { satrecFor, satellite } from '../public/js/lib/orbit.js';
import { arcDistance, makeFrame, fieldOfView, predictStreaks } from '../public/js/lib/streaks.js';
import { observerGd } from '../public/js/lib/passes.js';
import { D2R, R2D } from '../public/js/lib/astro.js';
import { fixtureJson } from './helpers.js';

test('field of view of a 135 mm lens on APS-C', () => {
  const f = fieldOfView(135, 23.5, 15.6);
  assert.ok(Math.abs(f.w - 9.95) < 0.02 && Math.abs(f.h - 6.61) < 0.02);
});

test('arc distance', () => {
  const a = [1, 0, 0], b = [0, 1, 0];
  assert.ok(Math.abs(arcDistance([Math.SQRT1_2, Math.SQRT1_2, 0], a, b)) < 1e-9);
  assert.ok(Math.abs(arcDistance([0, 0, 1], a, b) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(arcDistance([-1, 0, 0], a, b) - Math.PI / 2) < 1e-9); // nearest endpoint
});

test('frame centre projects to the middle of the sensor', () => {
  const now = new Date('2026-01-01T00:00Z'), f = makeFrame(10 * D2R, 41 * D2R, { w: 10, h: 6 }, 0, now);
  const c = f.project(f.t);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9 && c.inside);
});

test('a satellite aimed at exactly is found crossing the frame', () => {
  const objs = decodeCatalog(fixtureJson('catalog.json'));
  const iss = objs.find((o) => o.norad === 25544), rec = satrecFor(iss);
  const obs = { lat: 40, lon: -105, height: 1600 }, gd = observerGd(obs);
  // Find a moment when the ISS is high in this observer's sky.
  let t = epochMs(iss.epoch), best = null;
  for (let k = 0; k < 2 * 86400; k += 20) {
    const d = new Date(t + k * 1000), pv = satellite.propagate(rec, d), gm = satellite.gstime(d);
    const la = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, gm));
    if (la.elevation * R2D > 45) { best = { d, pv, gm }; break; }
  }
  assert.ok(best, 'ISS should rise above 45° within two days');
  const o = satellite.ecfToEci(satellite.geodeticToEcf(gd), best.gm), s = best.pv.position;
  const v = [s.x - o.x, s.y - o.y, s.z - o.z], r = Math.hypot(...v);
  // Topocentric RA/Dec of date; predictStreaks expects J2000, but the difference (~0.36°) is far inside a 10° frame.
  const ra = Math.atan2(v[1], v[0]) * R2D, dec = Math.asin(v[2] / r) * R2D;
  const res = predictStreaks([iss], obs, { ra: (ra + 360) % 360, dec }, { w: 10, h: 7 }, null, [{ start: +best.d - 30000, seconds: 60 }]);
  assert.equal(res.length, 1);
  assert.equal(res[0].norad, 25544);
  assert.ok(res[0].exit - res[0].enter < 30000, 'a fast LEO crossing lasts seconds');
});
