// Interpolate Horizons state vectors (heliocentric ecliptic J2000, AU and AU/day, daily samples).
export const AU_KM = 149597870.7, C_KMS = 299792.458;

export const jdOf = (ms) => ms / 86400000 + 2440587.5;
// Horizons times are TDB; UTC lags by about 69 s in 2026, far below what daily samples resolve.
const TDB_MINUS_UTC_DAYS = 69.2 / 86400;

// Cubic Hermite interpolation using positions and velocities. Returns null outside the samples.
export function stateAt(rows, ms) {
  const jd = jdOf(ms) + TDB_MINUS_UTC_DAYS;
  if (!rows?.length || jd < rows[0][0] || jd > rows[rows.length - 1][0]) return null;
  let i = Math.min(rows.length - 2, Math.max(0, Math.floor(jd - rows[0][0])));
  while (i > 0 && rows[i][0] > jd) i--;
  while (i < rows.length - 2 && rows[i + 1][0] < jd) i++;
  const a = rows[i], b = rows[i + 1], h = b[0] - a[0], t = (jd - a[0]) / h;
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  const p = [0, 1, 2].map((k) => h00 * a[1 + k] + h10 * h * a[4 + k] + h01 * b[1 + k] + h11 * h * b[4 + k]);
  const v = [0, 1, 2].map((k) => a[4 + k] + (b[4 + k] - a[4 + k]) * t);
  return { x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2] };
}

export function describe(body, earth) {
  const r = Math.hypot(body.x, body.y, body.z);
  const out = { sunAU: r, speedKms: Math.hypot(body.vx, body.vy, body.vz) * AU_KM / 86400 };
  if (earth) {
    const d = Math.hypot(body.x - earth.x, body.y - earth.y, body.z - earth.z);
    out.earthAU = d; out.earthKm = d * AU_KM; out.lightSec = d * AU_KM / C_KMS;
  }
  return out;
}

export function lightTime(sec, short = false) {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  if (short) return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
}
