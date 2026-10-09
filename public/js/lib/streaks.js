// Satellite streak prediction: which objects cross a camera's field of view during an exposure.
// Strategy: sample every object coarsely over the session, keep the ones whose path passes near
// the target, then re-sample those finely and test against the sensor rectangle.
import { satellite, propagateEci, satrecFor } from './orbit.js';
import { precessFromJ2000, unitFromRaDec, sunAltAz } from './astro.js';
import { observerGd } from './passes.js';

const D2R = Math.PI / 180;

export function fieldOfView(focalMm, sensorWmm, sensorHmm) {
  return { w: 2 * Math.atan(sensorWmm / (2 * focalMm)) / D2R, h: 2 * Math.atan(sensorHmm / (2 * focalMm)) / D2R };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const m = Math.hypot(a[0], a[1], a[2]); return [a[0] / m, a[1] / m, a[2] / m]; };

// Smallest angle between direction p and the great-circle arc from a to b (all unit vectors).
export function arcDistance(p, a, b) {
  const n = cross(a, b), nm = Math.hypot(...n);
  const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  if (nm < 1e-12) return ang(p, a);
  const nn = [n[0] / nm, n[1] / nm, n[2] / nm];
  // Project p onto the circle's plane; if that point lies between a and b, it is the closest.
  const k = dot(p, nn), q = unit([p[0] - k * nn[0], p[1] - k * nn[1], p[2] - k * nn[2]]);
  const between = dot(cross(a, q), nn) >= 0 && dot(cross(q, b), nn) >= 0;
  return between ? Math.abs(Math.asin(Math.max(-1, Math.min(1, k)))) : Math.min(ang(p, a), ang(p, b));
}

// Frame geometry for a target. rotationDeg is the angle of the sensor's long side east of north;
// null means unknown, in which case the circle circumscribing the frame is used (conservative).
export function makeFrame(raJ2000, decJ2000, fov, rotationDeg, date) {
  const p = precessFromJ2000(raJ2000, decJ2000, date), t = unitFromRaDec(p.ra, p.dec);
  let e = cross([0, 0, 1], t); e = Math.hypot(...e) < 1e-9 ? [1, 0, 0] : unit(e);
  const n = cross(t, e);
  const r = rotationDeg == null ? null : rotationDeg * D2R;
  const hw = Math.tan(fov.w / 2 * D2R), hh = Math.tan(fov.h / 2 * D2R);
  const radius = Math.atan(Math.hypot(hw, hh));
  return {
    t, radius,
    project(u) {
      const z = dot(u, t);
      if (z <= 0) return null;
      const x = dot(u, e) / z, y = dot(u, n) / z;
      if (r == null) { const k = Math.tan(radius); return { x: x / k, y: y / k, inside: Math.hypot(x, y) <= k }; }
      // Rotate sky coordinates into sensor coordinates (long side along x').
      const xs = x * Math.sin(r) + y * Math.cos(r), ys = -x * Math.cos(r) + y * Math.sin(r);
      return { x: xs / hw, y: ys / hh, inside: Math.abs(xs) <= hw && Math.abs(ys) <= hh };
    }
  };
}

function topo(rec, ms, gd) {
  const d = new Date(ms), pv = propagateEci(rec, d);
  if (!pv) return null;
  const gm = satellite.gstime(d), o = satellite.ecfToEci(satellite.geodeticToEcf(gd), gm), s = pv.position;
  const v = [s.x - o.x, s.y - o.y, s.z - o.z], range = Math.hypot(...v), u = [v[0] / range, v[1] / range, v[2] / range];
  const up = unit([o.x, o.y, o.z]);
  return { u, el: Math.asin(dot(u, up)) / D2R, range, pos: s, d };
}

function sunlit(pos, d) {
  return satellite.shadowFraction(satellite.sunPos(satellite.jday(d)).rsun, pos) < 0.99;
}

/**
 * Predict frame crossings.
 * objects: decoded catalog objects; obs: {lat, lon, height}; target: {ra, dec} J2000 degrees;
 * fov: {w, h} degrees; rotation: degrees or null; exposures: [{start: ms, seconds}];
 * opts.minEl: ignore objects below this altitude; opts.onProgress(fraction).
 * Returns streaks sorted by time: {norad, name, exposure, enter, exit, from, to, sunlit}.
 */
export function predictStreaks(objects, obs, target, fov, rotation, exposures, opts = {}) {
  if (!exposures.length) return [];
  const gd = observerGd(obs), minEl = opts.minEl ?? 0;
  const S = Math.min(...exposures.map((x) => x.start)), E = Math.max(...exposures.map((x) => x.start + x.seconds * 1000));
  const frame = makeFrame(target.ra * D2R, target.dec * D2R, fov, rotation, new Date((S + E) / 2));
  const out = [];
  for (let i = 0; i < objects.length; i++) {
    if (opts.onProgress && i % 500 === 0) opts.onProgress(i / objects.length);
    const o = objects[i], rec = satrecFor(o);
    if (!rec) continue;
    const step = o.mm > 8 ? 20000 : o.mm > 2 ? 120000 : 600000;
    let prev = topo(rec, S, gd);
    for (let t = S + step; prev && t < E + step; t += step) {
      const cur = topo(rec, Math.min(t, E), gd);
      if (!cur) break;
      if (cur.el > minEl - 5 || prev.el > minEl - 5) {
        const arc = Math.acos(Math.max(-1, Math.min(1, dot(prev.u, cur.u))));
        if (arcDistance(frame.t, prev.u, cur.u) < frame.radius + 0.15 * arc + 0.5 * D2R) {
          fine(o, rec, gd, frame, Math.max(S, t - step), Math.min(t, E), exposures, minEl, out);
        }
      }
      prev = cur;
    }
  }
  opts.onProgress?.(1);
  // A crossing that spans two coarse segments arrives in two pieces; join them.
  out.sort((a, b) => a.norad - b.norad || a.exposure - b.exposure || a.enter - b.enter);
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && last.norad === s.norad && last.exposure === s.exposure && s.enter - last.exit <= 500) {
      last.exit = Math.max(last.exit, s.exit); last.to = s.to; last.sunlit = last.sunlit || s.sunlit;
    } else merged.push({ ...s });
  }
  return merged.sort((a, b) => a.enter - b.enter);
}

function fine(o, rec, gd, frame, a, b, exposures, minEl, out) {
  let run = null;
  const close = () => {
    if (!run) return;
    for (let k = 0; k < exposures.length; k++) {
      const x = exposures[k], xs = x.start, xe = x.start + x.seconds * 1000;
      const s = Math.max(xs, run.enter), e = Math.min(xe, run.exit);
      if (s <= e) out.push({ norad: o.norad, name: o.name, exposure: k, enter: s, exit: e, from: run.from, to: run.to, sunlit: run.sunlit });
    }
    run = null;
  };
  for (let t = a; t <= b; t += 250) {
    const p = topo(rec, t, gd);
    const pr = p && p.el >= minEl ? frame.project(p.u) : null;
    if (pr && pr.inside) {
      const lit = sunlit(p.pos, p.d);
      if (!run) run = { enter: t, from: pr, sunlit: lit };
      run.exit = t; run.to = pr; run.sunlit = run.sunlit || lit;
    } else close();
  }
  close();
}

// Whether the sky is dark enough for imaging at an instant.
export function isDark(date, obs, level = -18) { return sunAltAz(date, obs.lat, obs.lon).alt < level; }

