// Low-precision Sun and Moon positions, coordinate transforms and event finding.
// Formulas are from the Astronomical Almanac's low-precision series (Sun ~0.01°, Moon ~0.3°)
// and Meeus, "Astronomical Algorithms", 2nd ed. Good for planning, not for pointing.

export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const J2000 = 2451545.0;

export function julian(date) { return +date / 86400000 + 2440587.5; }
const norm360 = (x) => ((x % 360) + 360) % 360;
const sind = (x) => Math.sin(x * D2R), cosd = (x) => Math.cos(x * D2R);

// Greenwich mean sidereal time in radians (IAU 1982).
export function gmst(date) {
  const d = julian(date) - J2000, T = d / 36525;
  const g = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T * T * T / 38710000;
  return norm360(g) * D2R;
}

export function obliquity(date) { return 23.439291 - 0.0130042 * (julian(date) - J2000) / 36525; }

function eclToEqu(lambda, beta, eps) {
  const ra = Math.atan2(sind(lambda) * cosd(eps) - Math.tan(beta * D2R) * sind(eps), cosd(lambda));
  const dec = Math.asin(sind(beta) * cosd(eps) + cosd(beta) * sind(eps) * sind(lambda));
  return { ra: (ra + 2 * Math.PI) % (2 * Math.PI), dec };
}

// Apparent geocentric Sun. ra/dec in radians, of date.
export function sunEquatorial(date) {
  const n = julian(date) - J2000;
  const L = norm360(280.460 + 0.9856474 * n), g = norm360(357.528 + 0.9856003 * n);
  const lambda = L + 1.915 * sind(g) + 0.020 * sind(2 * g);
  const R = 1.00014 - 0.01671 * cosd(g) - 0.00014 * cosd(2 * g);
  return { ...eclToEqu(lambda, 0, 23.439 - 0.0000004 * n), distAU: R, lambda };
}

// Geocentric Moon. distKm is centre-to-centre.
export function moonEquatorial(date) {
  const T = (julian(date) - J2000) / 36525;
  const lambda = 218.32 + 481267.881 * T
    + 6.29 * sind(134.9 + 477198.85 * T) - 1.27 * sind(259.2 - 413335.38 * T)
    + 0.66 * sind(235.7 + 890534.23 * T) + 0.21 * sind(269.9 + 954397.70 * T)
    - 0.19 * sind(357.5 + 35999.05 * T) - 0.11 * sind(186.6 + 966404.05 * T);
  const beta = 5.13 * sind(93.3 + 483202.03 * T) + 0.28 * sind(228.2 + 960400.87 * T)
    - 0.28 * sind(318.3 + 6003.18 * T) - 0.17 * sind(217.6 - 407332.20 * T);
  const hp = 0.9508 + 0.0518 * cosd(134.9 + 477198.85 * T) + 0.0095 * cosd(259.2 - 413335.38 * T)
    + 0.0078 * cosd(235.7 + 890534.23 * T) + 0.0028 * cosd(269.9 + 954397.70 * T);
  return { ...eclToEqu(norm360(lambda), beta, obliquity(date)), distKm: 6378.14 / sind(hp), hp, lambda: norm360(lambda), beta };
}

// Illuminated fraction and age-like phase of the Moon (Meeus ch. 48, simplified).
export function moonPhase(date) {
  const s = sunEquatorial(date), m = moonEquatorial(date);
  const cosPsi = Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const i = Math.atan2(s.distAU * 149597870.7 * Math.sin(psi), m.distKm - s.distAU * 149597870.7 * Math.cos(psi));
  const fraction = (1 + Math.cos(i)) / 2;
  const elong = norm360(m.lambda - s.lambda); // 0 new, 180 full
  const waxing = elong < 180;
  let name;
  if (fraction < 0.03) name = 'New moon';
  else if (fraction > 0.97) name = 'Full moon';
  else if (Math.abs(fraction - 0.5) < 0.05) name = waxing ? 'First quarter' : 'Last quarter';
  else name = (fraction < 0.5 ? (waxing ? 'Waxing crescent' : 'Waning crescent') : (waxing ? 'Waxing gibbous' : 'Waning gibbous'));
  return { fraction, waxing, name, elongation: elong };
}

// Equatorial (radians, of date) to horizontal for an observer at lat/lon (degrees).
export function toHorizontal(ra, dec, date, lat, lon) {
  const H = gmst(date) + lon * D2R - ra, phi = lat * D2R;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H));
  return { alt: alt * R2D, az: norm360(az * R2D) };
}

export function sunAltAz(date, lat, lon) { const s = sunEquatorial(date); return toHorizontal(s.ra, s.dec, date, lat, lon); }

// Topocentric Moon altitude: subtract parallax (≈ HP·cos alt).
export function moonAltAz(date, lat, lon) {
  const m = moonEquatorial(date), h = toHorizontal(m.ra, m.dec, date, lat, lon);
  return { alt: h.alt - m.hp * Math.cos(h.alt * D2R), az: h.az };
}

// Precess J2000 RA/Dec (radians) to the mean equator of date (IAU 1976, Meeus 21.2).
export function precessFromJ2000(ra, dec, date) {
  const T = (julian(date) - J2000) / 36525, as = D2R / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * as;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * as;
  const A = Math.cos(dec) * Math.sin(ra + zeta);
  const B = Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(theta) * Math.sin(dec);
  const C = Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(theta) * Math.sin(dec);
  return { ra: (Math.atan2(A, B) + z + 4 * Math.PI) % (2 * Math.PI), dec: Math.asin(Math.max(-1, Math.min(1, C))) };
}

export function unitFromRaDec(ra, dec) { return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]; }

export function separation(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

// Times where f(t) crosses `level`, scanning [start, end] in `stepMs` and refining by bisection.
export function crossings(f, start, end, stepMs, level = 0, tolMs = 1000) {
  const out = [];
  let t0 = +start, v0 = f(t0) - level;
  for (let t1 = t0 + stepMs; t0 < +end; t0 = t1, t1 += stepMs) {
    const tt = Math.min(t1, +end), v1 = f(tt) - level;
    if ((v0 < 0) !== (v1 < 0)) {
      let a = t0, b = tt, va = v0;
      while (b - a > tolMs) { const m = (a + b) / 2, vm = f(m) - level; if ((vm < 0) === (va < 0)) { a = m; va = vm; } else b = m; }
      out.push({ t: (a + b) / 2, rising: v1 > v0 });
    }
    v0 = v1;
    if (tt >= +end) break;
  }
  return out;
}

// Darkness windows for one night: from local noon on `day` to local noon on the next.
// Returns sunset/sunrise and the astronomical-dark interval, or nulls where they do not occur.
export function nightWindow(day, lat, lon) {
  const noon = new Date(day); noon.setUTCHours(12 - Math.round(lon / 15), 0, 0, 0);
  const end = +noon + 86400000, alt = (t) => sunAltAz(new Date(t), lat, lon).alt;
  const pick = (level) => {
    const c = crossings(alt, +noon, end, 10 * 60000, level, 30000);
    const set = c.find((x) => !x.rising), rise = c.find((x) => x.rising && (!set || x.t > set.t));
    return { start: set ? new Date(set.t) : null, end: rise ? new Date(rise.t) : null };
  };
  const sun = pick(-0.833), civil = pick(-6), nautical = pick(-12), astro = pick(-18);
  const midAlt = alt((+noon + end) / 2);
  return { sunset: sun.start, sunrise: sun.end, civil, nautical, astronomical: astro, alwaysDark: midAlt < -18 && !astro.start, noon, end: new Date(end) };
}

export function compass(az) {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round(norm360(az) / 22.5) % 16];
}
