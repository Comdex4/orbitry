// Heliocentric state vectors for planets and deep-space probes from NASA/JPL Horizons.
// Daily samples over a window around today; the browser interpolates between them.
import { cachedFetch } from './lib.js';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
export const PLANETS = [
  { id: '199', name: 'Mercury' }, { id: '299', name: 'Venus' }, { id: '399', name: 'Earth' }, { id: '499', name: 'Mars' },
  { id: '599', name: 'Jupiter' }, { id: '699', name: 'Saturn' }, { id: '799', name: 'Uranus' }, { id: '899', name: 'Neptune' }
];

const day = (t) => new Date(t).toISOString().slice(0, 10);

function url(id, start, stop) {
  const p = new URLSearchParams({
    format: 'json', COMMAND: `'${id}'`, EPHEM_TYPE: 'VECTORS', CENTER: "'500@10'", REF_PLANE: 'ECLIPTIC',
    START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: "'1 d'", VEC_TABLE: '2', OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'YES', VEC_LABELS: 'NO', OBJ_DATA: 'NO'
  });
  return `${API}?${p}`;
}

// Rows between $$SOE and $$EOE: JDTDB, calendar, X, Y, Z, VX, VY, VZ.
export function parseVectors(result) {
  const body = result.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) return null;
  return body.trim().split('\n').map((l) => {
    const f = l.split(',').map((s) => s.trim());
    return [Number(f[0]), ...f.slice(2, 8).map(Number)].map((v, i) => (i === 0 ? v : Math.round(v * 1e9) / 1e9));
  });
}

async function vectors(id, start, stop) {
  const r = await cachedFetch(`horizons-${id}-${start}-${stop}.json`, url(id, start, stop), 20);
  const j = JSON.parse(r.text);
  const rows = j.result ? parseVectors(j.result) : null;
  if (rows && rows.length) return rows;
  // Some probes have ephemerides that end soon (e.g. arrival at a target). Use what exists.
  const m = /No ephemeris for target .* after A\.D\. (\d{4})-([A-Z]{3})-(\d{2})/.exec(j.result || j.error || '');
  if (m) {
    const mon = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2]) / 3;
    const end = new Date(Date.UTC(+m[1], mon, +m[3]) - 864e5);
    if (end > Date.parse(start)) return vectors(id, start, day(end));
  }
  throw new Error(`Horizons returned no vectors for ${id}`);
}

export async function fetchSolarSystem(probes, now = Date.now()) {
  const start = day(now - 30 * 864e5), stop = day(now + 90 * 864e5);
  const bodies = [];
  for (const b of [...PLANETS.map((p) => ({ ...p, kind: 'planet' })), ...probes.map((p) => ({ ...p, kind: 'probe' }))]) {
    try {
      bodies.push({ id: b.horizons || b.id, slug: b.slug || b.name.toLowerCase(), name: b.name, kind: b.kind, v: await vectors(b.horizons || b.id, start, stop) });
    } catch (e) {
      console.warn(`  ! ${b.name}: ${e.message}`);
    }
  }
  return {
    generated: new Date().toISOString(),
    source: { name: 'NASA/JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/', frame: 'Heliocentric, ecliptic and mean equinox of J2000', units: 'AU, AU/day, time as TDB Julian date' },
    window: { start, stop }, bodies
  };
}
