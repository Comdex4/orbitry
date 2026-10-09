// Pass prediction for an observer on the ground: when an object rises, culminates and sets,
// whether it can be seen (sunlit object, dark sky), and an estimated brightness where the
// object's intrinsic magnitude is known.
import { satellite, propagateEci } from './orbit.js';
import { sunAltAz, compass } from './astro.js';

const AU = 149597870.7, D2R = Math.PI / 180;

// Standard magnitude at 1,000 km range and 90° phase angle, from visual observations
// compiled by the satellite-observing community (Mike McCants' intrinsic magnitude list).
export const STD_MAG = { 25544: -1.8 };

export function observerGd(obs) {
  return { latitude: obs.lat * D2R, longitude: obs.lon * D2R, height: (obs.height || 0) / 1000 };
}

// Everything about the object's position relative to the observer at one instant.
export function look(rec, date, gd, wantLight = false) {
  const pv = propagateEci(rec, date);
  if (!pv) return null;
  const gm = satellite.gstime(date), ecf = satellite.eciToEcf(pv.position, gm);
  const la = satellite.ecfToLookAngles(gd, ecf);
  const out = { t: +date, el: la.elevation / D2R, az: (la.azimuth / D2R + 360) % 360, range: la.rangeSat, eci: pv.position };
  if (wantLight) {
    const sun = satellite.sunPos(satellite.jday(date)).rsun;
    out.sunlit = satellite.shadowFraction(sun, pv.position) < 0.99;
    const obs = satellite.ecfToEci(satellite.geodeticToEcf(gd), gm);
    const s = pv.position, toSun = [sun.x * AU - s.x, sun.y * AU - s.y, sun.z * AU - s.z], toObs = [obs.x - s.x, obs.y - s.y, obs.z - s.z];
    const dot = toSun[0] * toObs[0] + toSun[1] * toObs[1] + toSun[2] * toObs[2];
    out.phase = Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...toSun) * Math.hypot(...toObs)))));
  }
  return out;
}

export function magnitude(stdMag, range, phase) {
  const F = (Math.sin(phase) + (Math.PI - phase) * Math.cos(phase)) / Math.PI;
  if (F <= 0) return null;
  return stdMag + 5 * Math.log10(range / 1000) - 2.5 * Math.log10(F * Math.PI);
}

function refine(f, a, b, tol = 1000) {
  // f changes sign between a and b; returns the crossing time.
  let fa = f(a);
  while (b - a > tol) { const m = (a + b) / 2, fm = f(m); if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m; }
  return (a + b) / 2;
}

function culminate(f, a, b) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  while (b - a > 1000) { if (f(c) > f(d)) { b = d; } else { a = c; } c = b - g * (b - a); d = a + g * (b - a); }
  return (a + b) / 2;
}

/**
 * Predict passes between `start` and `end`.
 * opts: minEl (deg, default 10), visibleOnly, stdMag, twilight (sun altitude for "dark", default -6)
 */
export function predictPasses(rec, obs, start, end, opts = {}) {
  const minEl = opts.minEl ?? 10, twilight = opts.twilight ?? -6, gd = observerGd(obs);
  const mpd = rec.no * 1440 / (2 * Math.PI);
  const step = mpd > 8 ? 30000 : mpd > 2 ? 120000 : 600000;
  const elev = (t) => { const l = look(rec, new Date(t), gd); return l ? l.el : -90; };
  const passes = [];
  let t = +start, prev = elev(t), riseT = prev > 0 ? t : null;
  if (riseT !== null) {
    // Object already above the horizon at start: if it never sets in the window, say so.
    const always = [0.25, 0.5, 0.75, 1].every((k) => elev(+start + k * (end - start)) > 0);
    if (always) return { alwaysUp: true, passes: [] };
  }
  for (t += step; t <= +end + step; t += step) {
    const cur = elev(t);
    if (prev <= 0 && cur > 0) riseT = refine(elev, t - step, t);
    if (prev > 0 && cur <= 0 && riseT !== null) {
      const setT = refine((x) => -elev(x), t - step, t);
      const p = describe(rec, gd, riseT, setT, { ...opts, minEl, twilight });
      if (p) passes.push(p);
      riseT = null;
    }
    prev = cur;
  }
  return { alwaysUp: false, passes: opts.visibleOnly ? passes.filter((p) => p.visible) : passes };
}

function describe(rec, gd, riseT, setT, opts) {
  const elev = (t) => { const l = look(rec, new Date(t), gd); return l ? l.el : -90; };
  const maxT = culminate(elev, riseT, setT);
  const max = look(rec, new Date(maxT), gd, true);
  if (!max || max.el < opts.minEl) return null;
  const lat = gd.latitude / D2R, lon = gd.longitude / D2R;
  // Walk the pass to find the stretch where the object is sunlit against a dark sky.
  let vis = null, best = null;
  const std = opts.stdMag ?? STD_MAG[rec.satnum];
  for (let t = riseT; t <= setT; t += 10000) {
    const l = look(rec, new Date(t), gd, true);
    if (!l) continue;
    const dark = sunAltAz(new Date(t), lat, lon).alt < opts.twilight;
    if (l.sunlit && dark && l.el > 0) {
      if (!vis) vis = { start: l };
      vis.end = l;
      if (!best || l.el > best.el) best = l;
    }
  }
  const pt = (l) => ({ time: new Date(l.t), az: l.az, el: l.el, dir: compass(l.az), range: l.range });
  const rise = look(rec, new Date(riseT), gd), set = look(rec, new Date(setT), gd);
  return {
    rise: pt(rise), max: pt(max), set: pt(set), duration: (setT - riseT) / 1000,
    visible: !!vis,
    visibleFrom: vis ? pt(vis.start) : null, visibleTo: vis ? pt(vis.end) : null, visibleMax: best ? pt(best) : null,
    magnitude: vis && std != null ? magnitude(std, best.range, best.phase) : null
  };
}
