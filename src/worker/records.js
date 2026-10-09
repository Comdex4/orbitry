// The factual record behind an object page, as given to Claude. It holds only what the page
// shows: catalog fields, curated facts and sources, and live values computed for this moment.
import { HttpError } from './http.js';
import { asset, catalog } from './data.js';
import { publicObject } from '../../public/js/lib/catalog.js';
import { satrecFor, stateAt, ageDays } from '../../public/js/lib/orbit.js';
import { stateAt as ephState, describe as ephDescribe } from '../../public/js/lib/ephemeris.js';

const r2 = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const strip = ({ review, photo, model, wikidata, ...rest }) => rest;

// ids: "norad-25544", "moon-apollo-11", "mars-curiosity", "probe-voyager-1"
export async function recordFor(env, id, now = Date.now()) {
  const m = /^(norad|moon|mars|probe)-([\w-]+)$/.exec(String(id || ''));
  if (!m) throw new HttpError(400, 'Unknown object id');
  const [, kind, key] = m;
  if (kind === 'norad') {
    const o = (await catalog(env)).byNorad.get(Number(key));
    if (!o) throw new HttpError(404, 'That object is not in the current catalog.');
    const { elements, ...facts } = publicObject(o);
    const s = stateAt(satrecFor(o), new Date(now));
    return {
      id, name: o.name,
      record: {
        ...facts,
        now: s ? { time: new Date(now).toISOString(), altitude_km: Math.round(s.alt), speed_km_s: r2(s.speed, 2), latitude_deg: r2(s.lat, 2), longitude_deg: r2(s.lon, 2) } : null,
        data_age_days: r2(ageDays(o, now)),
        sources: [{ title: 'CelesTrak GP orbital elements', url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${o.norad}&FORMAT=json` },
          { title: "Jonathan McDowell's GCAT", url: 'https://planet4589.org/space/gcat/' }]
      }
    };
  }
  if (kind === 'probe') {
    const [pr, ss] = await Promise.all([asset(env, 'probes.json'), asset(env, 'solar-system.json').catch(() => null)]);
    const p = pr.probes.find((x) => x.slug === key);
    if (!p) throw new HttpError(404, 'No such probe.');
    let now_ = null;
    const b = ss?.bodies.find((x) => x.slug === key), e = ss?.bodies.find((x) => x.name === 'Earth');
    const s = b && ephState(b.v, now), es = e && ephState(e.v, now);
    if (s && es) {
      const d = ephDescribe(s, es);
      now_ = { time: new Date(now).toISOString(), distance_from_earth_km: Math.round(d.earthKm), distance_from_earth_au: r2(d.earthAU, 2), distance_from_sun_au: r2(d.sunAU, 2), one_way_light_time_hours: r2(d.lightSec / 3600, 2), speed_relative_to_sun_km_s: r2(d.speedKms, 2) };
    }
    return { id, name: p.name, record: { ...strip(p), now: now_ } };
  }
  const d = await asset(env, `${kind}.json`);
  const r = d.sites.find((x) => x.slug === key) || d.orbiters.find((x) => x.slug === key);
  if (!r) throw new HttpError(404, 'No such record.');
  return { id, name: r.name, record: { body: kind === 'moon' ? 'Moon' : 'Mars', ...strip(r) } };
}

export function getPath(obj, p) {
  return String(p).replace(/\[(\d+)\]/g, '.$1').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

