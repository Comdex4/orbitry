// SGP4 propagation helpers around satellite.js. Positions are what public element sets
// support: good to a few kilometres near the epoch, degrading as the elements age.
import * as satellite from '../../vendor/satellite.js/index.js';
import { toOMM, epochMs } from './catalog.js';

export const RE = 6371.0;

const cache = new Map();
export function satrecFor(o) {
  let r = cache.get(o.norad);
  if (!r || r._epoch !== o.epoch) {
    try { r = satellite.json2satrec(toOMM(o)); } catch { r = null; }
    if (r) r._epoch = o.epoch;
    cache.set(o.norad, r);
  }
  return r && !r.error ? r : null;
}

// ECI (TEME) position/velocity in km and km/s, or null if SGP4 cannot produce one.
export function propagateEci(rec, date) {
  if (!rec) return null;
  const pv = satellite.propagate(rec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean' || Number.isNaN(pv.position.x)) return null;
  return pv;
}

export function stateAt(rec, date, gmst = satellite.gstime(date)) {
  const pv = propagateEci(rec, date);
  if (!pv) return null;
  const ecf = satellite.eciToEcf(pv.position, gmst), g = satellite.eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  return {
    eci: pv.position, vel: v, ecf,
    lat: satellite.degreesLat(g.latitude), lon: satellite.degreesLong(g.longitude), alt: g.height,
    speed: Math.hypot(v.x, v.y, v.z)
  };
}

// Points (ECF km) along one orbit starting at `date`, for drawing the ground-fixed trace.
export function orbitTrace(rec, date, periodMin, steps = 180, gmstFixed) {
  const pts = [], T = periodMin * 60000, gm = gmstFixed ?? satellite.gstime(date);
  for (let k = 0; k <= steps; k++) {
    const pv = propagateEci(rec, new Date(+date + (k / steps) * T));
    if (pv) pts.push(satellite.eciToEcf(pv.position, gm));
  }
  return pts;
}

// Ground track (lat/lon degrees) over a window, split where it wraps the antimeridian.
export function groundTrack(rec, start, minutes, stepSec = 30) {
  const segs = [[]];
  let prev = null;
  for (let s = 0; s <= minutes * 60; s += stepSec) {
    const d = new Date(+start + s * 1000), st = stateAt(rec, d);
    if (!st) continue;
    if (prev !== null && Math.abs(st.lon - prev) > 180) segs.push([]);
    segs[segs.length - 1].push([st.lat, st.lon]);
    prev = st.lon;
  }
  return segs.filter((s) => s.length > 1);
}

export function ageDays(o, now = Date.now()) { return (now - epochMs(o.epoch)) / 86400000; }

// Plain-language accuracy statement for an element set of a given age.
// Rule of thumb from published SGP4/TLE accuracy studies: around 1 km at epoch for LEO,
// growing by roughly 1–3 km per day, faster for low, high-drag orbits and during solar storms.
export function accuracyNote(o, now = Date.now()) {
  const age = Math.abs(ageDays(o, now)), low = o.orbit === 'leo';
  if (age > 30) return { level: 'stale', text: `These elements are ${Math.round(age)} days old. The position shown may be off by hundreds of kilometres or more.` };
  const per = low ? [1, 3] : [0.5, 2];
  const lo = Math.max(1, Math.round(1 + per[0] * age)), hi = Math.max(3, Math.round(3 + per[1] * age));
  return {
    level: age > 7 ? 'aging' : 'fresh',
    text: `Elements are ${age < 1 ? 'less than a day' : age.toFixed(1) + ' days'} old. Expect the position to be within roughly ${lo}–${hi} km, more for low objects with high drag.`
  };
}

export { satellite };
