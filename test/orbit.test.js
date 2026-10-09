import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCatalog, epochMs } from '../public/js/lib/catalog.js';
import { satrecFor, stateAt, accuracyNote, groundTrack } from '../public/js/lib/orbit.js';
import { predictPasses, magnitude } from '../public/js/lib/passes.js';
import { fixtureJson } from './helpers.js';

const objs = decodeCatalog(fixtureJson('catalog.json'));
const by = (n) => objs.find((o) => o.norad === n);
const iss = by(25544), goes = by(41866);
const t0 = epochMs(iss.epoch);

test('ISS state is a plausible low orbit', () => {
  const s = stateAt(satrecFor(iss), new Date(t0 + 3600e3));
  assert.ok(s.alt > 380 && s.alt < 460, `alt ${s.alt}`);
  assert.ok(Math.abs(s.speed - 7.66) < 0.1, `speed ${s.speed}`);
  assert.ok(Math.abs(s.lat) <= 52);
});

test('GOES 16 sits near the equator at geostationary altitude', () => {
  const s = stateAt(satrecFor(goes), new Date(epochMs(goes.epoch)));
  assert.ok(Math.abs(s.alt - 35786) < 100, `alt ${s.alt}`);
  assert.ok(Math.abs(s.lat) < 1);
});

test('ISS passes are internally consistent', () => {
  const rec = satrecFor(iss), obs = { lat: 40.0, lon: -105.0, height: 1600 };
  const { passes } = predictPasses(rec, obs, new Date(t0), new Date(t0 + 3 * 864e5), { minEl: 10 });
  assert.ok(passes.length >= 4, `only ${passes.length} passes`);
  for (const p of passes) {
    assert.ok(+p.rise.time < +p.max.time && +p.max.time < +p.set.time);
    assert.ok(Math.abs(p.rise.el) < 0.5 && Math.abs(p.set.el) < 0.5, 'rise/set at the horizon');
    assert.ok(p.max.el >= 10 && p.max.el <= 90);
    assert.ok(p.duration > 60 && p.duration < 15 * 60);
    if (p.visible) assert.ok(p.visibleFrom && p.visibleTo && +p.visibleFrom.time <= +p.visibleTo.time);
  }
});

test('a geostationary satellite is reported as always up, not as passes', () => {
  const t = epochMs(goes.epoch);
  const r = predictPasses(satrecFor(goes), { lat: 30, lon: -75 }, new Date(t), new Date(t + 864e5));
  assert.equal(r.alwaysUp, true);
});

test('magnitude falls off with range and phase', () => {
  const near = magnitude(-1.8, 400, Math.PI / 4), far = magnitude(-1.8, 1500, Math.PI / 4), side = magnitude(-1.8, 400, Math.PI * 0.75);
  assert.ok(near < far && near < side);
});

test('accuracy notes escalate with age', () => {
  assert.equal(accuracyNote(iss, t0 + 0.5 * 864e5).level, 'fresh');
  assert.equal(accuracyNote(iss, t0 + 10 * 864e5).level, 'aging');
  assert.equal(accuracyNote(iss, t0 + 40 * 864e5).level, 'stale');
});

test('ground track splits at the antimeridian', () => {
  const segs = groundTrack(satrecFor(iss), new Date(t0), 200, 60);
  assert.ok(segs.length >= 2);
  for (const s of segs) for (let i = 1; i < s.length; i++) assert.ok(Math.abs(s[i][1] - s[i - 1][1]) < 180);
});
