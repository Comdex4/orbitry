import test from 'node:test';
import assert from 'node:assert/strict';
import { sunEquatorial, moonPhase, nightWindow, toHorizontal, precessFromJ2000, separation, unitFromRaDec, R2D, D2R, compass } from '../public/js/lib/astro.js';

test('Sun declination at the June solstice is about +23.44°', () => {
  const s = sunEquatorial(new Date('2024-06-20T20:51Z'));
  assert.ok(Math.abs(s.dec * R2D - 23.44) < 0.05, `dec ${s.dec * R2D}`);
});

test('Moon phase: new at the 2024-04-08 eclipse, full on 2024-04-23', () => {
  assert.ok(moonPhase(new Date('2024-04-08T18:21Z')).fraction < 0.01);
  const full = moonPhase(new Date('2024-04-23T23:49Z'));
  assert.ok(full.fraction > 0.99, String(full.fraction));
  assert.equal(full.name, 'Full moon');
});

test('London sunset on the 2024 summer solstice is about 21:21 BST (20:21 UTC)', () => {
  const n = nightWindow(new Date('2024-06-21T00:00Z'), 51.5074, -0.1278);
  const minutes = n.sunset.getUTCHours() * 60 + n.sunset.getUTCMinutes();
  assert.ok(Math.abs(minutes - (20 * 60 + 21)) <= 4, n.sunset.toISOString());
  const rise = n.sunrise.getUTCHours() * 60 + n.sunrise.getUTCMinutes();
  assert.ok(Math.abs(rise - (3 * 60 + 43)) <= 4, n.sunrise.toISOString()); // 04:43 BST
  // No astronomical darkness in London at midsummer.
  assert.equal(n.astronomical.start, null);
});

test('Polaris is roughly at the observer latitude in altitude', () => {
  const p = precessFromJ2000(37.954 * D2R, 89.264 * D2R, new Date('2026-01-01T00:00Z'));
  const h = toHorizontal(p.ra, p.dec, new Date('2026-01-01T00:00Z'), 45, 10);
  assert.ok(Math.abs(h.alt - 45) < 1, String(h.alt));
});

test('precession over 26 years moves a star by about 0.36°', () => {
  const ra = 83.82 * D2R, dec = -5.39 * D2R, p = precessFromJ2000(ra, dec, new Date('2026-01-01T00:00Z'));
  const d = separation(unitFromRaDec(ra, dec), unitFromRaDec(p.ra, p.dec)) * R2D;
  assert.ok(d > 0.3 && d < 0.42, String(d));
});

test('compass points', () => {
  assert.equal(compass(0), 'N'); assert.equal(compass(359), 'N'); assert.equal(compass(225), 'SW'); assert.equal(compass(100), 'E');
});
