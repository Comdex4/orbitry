// Astrophotography night planning: darkness, Moon, weather and target visibility for one night.
// Pure functions plus a weather fetch, shared by the planner page and the nightly email.
import { nightWindow, moonPhase, moonAltAz, moonEquatorial, toHorizontal, precessFromJ2000, unitFromRaDec, separation, D2R, compass } from './astro.js';

// Open-Meteo forecast (free, no key). Hourly values in UTC.
export async function fetchWeather(lat, lon, fetchFn = fetch) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3), timezone: 'UTC', forecast_days: '3',
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,dew_point_2m,temperature_2m,wind_speed_10m,visibility'
  });
  const r = await fetchFn(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!r.ok) throw new Error(`Weather unavailable (${r.status})`);
  const j = await r.json(), h = j.hourly;
  return h.time.map((t, i) => ({
    t: Date.parse(t + 'Z'), cloud: h.cloud_cover[i], low: h.cloud_cover_low[i], mid: h.cloud_cover_mid[i], high: h.cloud_cover_high[i],
    rh: h.relative_humidity_2m[i], dew: h.dew_point_2m[i], temp: h.temperature_2m[i], wind: h.wind_speed_10m[i], vis: h.visibility[i]
  }));
}

export function weatherAt(weather, t) {
  if (!weather?.length) return null;
  let best = null;
  for (const w of weather) if (!best || Math.abs(w.t - t) < Math.abs(best.t - t)) best = w;
  return Math.abs(best.t - t) <= 90 * 60000 ? best : null;
}

// Minimum usable altitude at an azimuth: the larger of a global minimum and the horizon
// profile (evenly spaced altitudes starting at north, going clockwise).
export function horizonAt(az, horizon, minAlt = 20) {
  if (!horizon?.length) return minAlt;
  const step = 360 / horizon.length, i = Math.floor(((az % 360) + 360) % 360 / step), f = (az - i * step) / step;
  const a = horizon[i], b = horizon[(i + 1) % horizon.length];
  return Math.max(minAlt, a + (b - a) * f);
}

/**
 * Plan one night.
 * obs: {lat, lon}; day: Date within the local day the night starts; opts: {targets, weather,
 * horizon, minAlt, fov: {w, h} degrees, stepMin}
 */
export function planNight(obs, day, opts = {}) {
  const { lat, lon } = obs, minAlt = opts.minAlt ?? 20, step = (opts.stepMin ?? 15) * 60000;
  const night = nightWindow(day, lat, lon);
  // Imaging window: astronomical darkness if it happens, otherwise nautical, otherwise none.
  const win = night.astronomical.start && night.astronomical.end ? { ...night.astronomical, level: 'astronomical' }
    : night.nautical.start && night.nautical.end ? { ...night.nautical, level: 'nautical' } : null;
  const phase = moonPhase(win ? new Date((+win.start + +win.end) / 2) : day);
  const hours = [];
  if (win) {
    for (let t = +win.start; t <= +win.end; t += step) {
      const m = moonAltAz(new Date(t), lat, lon), w = weatherAt(opts.weather, t);
      hours.push({ t, moonAlt: m.alt, cloud: w ? w.cloud : null, weather: w });
    }
  }
  const moonUpFrac = hours.length ? hours.filter((h) => h.moonAlt > 0).length / hours.length : 0;
  const cloudy = hours.filter((h) => h.cloud != null);
  const meanCloud = cloudy.length ? cloudy.reduce((s, h) => s + h.cloud, 0) / cloudy.length : null;

  const targets = (opts.targets || []).map((tg) => scoreTarget(tg, hours, obs, opts, minAlt, phase)).filter((x) => x.usableMin > 0)
    .sort((a, b) => b.score - a.score);

  let verdict;
  if (!win) verdict = 'No real darkness tonight';
  else if (meanCloud != null && meanCloud > 75) verdict = 'Cloudy';
  else if (meanCloud != null && meanCloud > 40) verdict = 'Partly cloudy';
  else if (phase.fraction > 0.6 && moonUpFrac > 0.5) verdict = 'Clear but a bright Moon';
  else verdict = meanCloud == null ? 'Dark (no forecast yet)' : 'Clear and dark';
  return { night, window: win, moon: { ...phase, upFraction: moonUpFrac }, meanCloud, hours, targets, verdict };
}

function scoreTarget(tg, hours, obs, opts, minAlt, phase) {
  const mid = hours.length ? new Date(hours[Math.floor(hours.length / 2)].t) : new Date();
  const p = precessFromJ2000(tg.ra * D2R, tg.dec * D2R, mid), u = unitFromRaDec(p.ra, p.dec);
  let score = 0, usable = 0, maxAlt = -90, bestT = null, bestW = -1, moonSep = null;
  for (const h of hours) {
    const d = new Date(h.t), hz = toHorizontal(p.ra, p.dec, d, obs.lat, obs.lon);
    if (hz.alt > maxAlt) maxAlt = hz.alt;
    const floor = horizonAt(hz.az, opts.horizon, minAlt);
    if (hz.alt < floor) continue;
    const m = moonEquatorial(d), sep = separation(u, unitFromRaDec(m.ra, m.dec)) / D2R;
    moonSep = moonSep == null ? sep : Math.min(moonSep, sep);
    // Moonlight penalty grows with illumination, falls with separation, vanishes when the Moon is down.
    const moonPen = h.moonAlt > 0 ? phase.fraction * Math.max(0, 1 - sep / 120) : 0;
    const clear = h.cloud == null ? 0.7 : 1 - h.cloud / 100;
    const airmass = 1 / Math.sin(Math.max(hz.alt, 5) * D2R);
    const w = clear * (1 - 0.8 * moonPen) / airmass;
    score += w; usable += (opts.stepMin ?? 15);
    if (w > bestW) { bestW = w; bestT = h.t; }
  }
  let note = null;
  if (opts.fov && tg.size_arcmin) {
    const sizeDeg = tg.size_arcmin / 60, fovMin = Math.min(opts.fov.w, opts.fov.h);
    if (sizeDeg > fovMin) note = 'larger than your field of view: consider a mosaic or shorter focal length';
    else if (sizeDeg < fovMin / 12) note = 'small in your frame: needs more focal length';
  }
  if (!note && moonSep != null && moonSep < 35 && phase.fraction > 0.4) note = `${Math.round(moonSep)}° from a bright Moon`;
  return { ...tg, score, usableMin: usable, maxAlt: Math.round(maxAlt), best: bestT, note };
}

export { compass };
