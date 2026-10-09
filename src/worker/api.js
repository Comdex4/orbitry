// Public JSON API, v1. Free without a key (low daily limit), more with a free key, and bulk
// downloads, history and alerts with API Pro. Every response carries attribution.
import { HttpError, json, sha256, num, CORS } from './http.js';
import { API_TIERS, ATTRIBUTION } from './plans.js';
import { asset, catalog } from './data.js';
import { publicObject, ORBITS, PURPOSES, TYPES, epochMs } from '../../public/js/lib/catalog.js';
import { satrecFor, stateAt, accuracyNote, ageDays } from '../../public/js/lib/orbit.js';
import { predictPasses } from '../../public/js/lib/passes.js';
import { stateAt as ephState, describe as ephDescribe } from '../../public/js/lib/ephemeris.js';
import { listAlerts, createAlert, deleteAlert } from './account.js';

export async function apiCaller(req, env) {
  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const key = (auth.startsWith('Bearer ') ? auth.slice(7) : null) || req.headers.get('x-api-key') || url.searchParams.get('key');
  if (key) {
    const row = await env.DB.prepare('SELECT k.id AS key_id, u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL')
      .bind(await sha256(key.trim())).first();
    if (!row) throw new HttpError(401, 'Unknown or revoked API key');
    const tier = row.api_plan === 'pro' ? 'pro' : 'free';
    return { tier, subject: `key:${row.key_id}`, user: row, keyId: row.key_id };
  }
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  return { tier: 'anonymous', subject: `ip:${(await sha256(ip + (env.IP_SALT || ''))).slice(0, 24)}`, user: null };
}

async function meter(env, caller) {
  const day = new Date().toISOString().slice(0, 10), limit = API_TIERS[caller.tier].perDay;
  const row = await env.DB.prepare('INSERT INTO usage (subject, day, count) VALUES (?, ?, 1) ON CONFLICT (subject, day) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(caller.subject, day).first();
  if (caller.keyId && row.count % 50 === 1) await env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), caller.keyId).run();
  const headers = { 'x-ratelimit-limit': String(limit), 'x-ratelimit-remaining': String(Math.max(0, limit - row.count)), 'x-orbitry-tier': caller.tier };
  if (row.count > limit) throw new HttpError(429, `Daily limit of ${limit.toLocaleString()} requests reached for the ${API_TIERS[caller.tier].label} tier. Limits reset at 00:00 UTC.`, { upgrade: 'https://orbitry.net/developers/' });
  return headers;
}

const need = (caller, feature) => {
  if (!API_TIERS[caller.tier][feature]) throw new HttpError(403, `This endpoint needs an API Pro key. See https://orbitry.net/developers/`);
};

const ok = (data, meta = {}, headers = {}) => json({ data, meta: { attribution: ATTRIBUTION, ...meta } }, { headers: { ...CORS, 'cache-control': 'public, max-age=60', ...headers } });

function summary(o) {
  return {
    norad: o.norad, name: o.name, intl: o.intl, type: TYPES[o.type] || null, orbit: ORBITS[o.orbit].label,
    purpose: PURPOSES[o.purpose].label, country: o.countryName, operator: o.operatorName, launch_date: o.launch,
    epoch: new Date(epochMs(o.epoch)).toISOString()
  };
}

async function objectOr404(env, id) {
  const { byNorad } = await catalog(env);
  const o = byNorad.get(Number(id));
  if (!o) throw new HttpError(404, `No active object with NORAD number ${id}. It may have re-entered or not be publicly tracked.`);
  return o;
}

let bulkCache = null;

export async function handleApi(req, env, path) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const caller = await apiCaller(req, env), headers = await meter(env, caller), url = new URL(req.url), q = url.searchParams;
  const seg = path.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean);

  if (!seg.length) return ok({
    endpoints: ['/api/v1/objects', '/api/v1/objects/{norad}', '/api/v1/objects/{norad}/position', '/api/v1/objects/{norad}/passes', '/api/v1/objects/{norad}/history (Pro)',
      '/api/v1/catalog (Pro)', '/api/v1/moon', '/api/v1/mars', '/api/v1/deep-space', '/api/v1/launches', '/api/v1/reentries', '/api/v1/alerts (Pro)'],
    docs: 'https://orbitry.net/developers/', tier: caller.tier
  }, {}, headers);

  if (seg[0] === 'objects' && seg.length === 1) {
    const { objects, raw } = await catalog(env);
    const term = (q.get('q') || '').toLowerCase().trim(), limit = num(q.get('limit') ?? 100, { min: 1, max: 500, name: 'limit' }), offset = num(q.get('offset') ?? 0, { min: 0, max: 1e6, name: 'offset' });
    const f = { orbit: q.get('orbit'), purpose: q.get('purpose'), type: q.get('type'), country: q.get('country')?.toLowerCase(), operator: q.get('operator')?.toLowerCase() };
    const hits = objects.filter((o) => (!term || o.name.toLowerCase().includes(term) || String(o.norad) === term || o.intl === term.toUpperCase())
      && (!f.orbit || o.orbit === f.orbit) && (!f.purpose || o.purpose === f.purpose) && (!f.type || o.type === f.type)
      && (!f.country || (o.countryName || '').toLowerCase().includes(f.country) || (o.countryCode || '').toLowerCase() === f.country)
      && (!f.operator || (o.operatorName || '').toLowerCase().includes(f.operator)));
    return ok(hits.slice(offset, offset + limit).map(summary), { total: hits.length, limit, offset, generated: raw.generated, filters: { orbit: Object.keys(ORBITS), purpose: Object.keys(PURPOSES), type: Object.keys(TYPES) } }, headers);
  }

  if (seg[0] === 'objects' && seg.length >= 2) {
    const o = await objectOr404(env, seg[1]);
    if (seg.length === 2) {
      const [media, models, desc] = await Promise.all([asset(env, 'media.json').catch(() => ({ norad: {} })), asset(env, 'models.json').catch(() => ({})), asset(env, 'descriptions.json').catch(() => ({}))]);
      return ok({ ...publicObject(o), photo: media.norad?.[o.norad] || null, model: models[o.norad] || null, summary: desc[`norad-${o.norad}`] || null },
        { data_age_days: Math.round(ageDays(o) * 100) / 100, accuracy: accuracyNote(o).text }, headers);
    }
    const rec = satrecFor(o);
    if (seg[2] === 'position') {
      const t = q.get('t') ? Date.parse(q.get('t')) : Date.now();
      if (!Number.isFinite(t)) throw new HttpError(400, 't must be an ISO 8601 time');
      if (Math.abs(t - epochMs(o.epoch)) > 30 * 864e5) throw new HttpError(422, 'Time is more than 30 days from the element epoch; the result would not be meaningful.');
      const s = stateAt(rec, new Date(t));
      if (!s) throw new HttpError(422, 'SGP4 could not compute a position for this time.');
      return ok({ time: new Date(t).toISOString(), lat: s.lat, lon: s.lon, alt_km: s.alt, speed_kms: s.speed, eci_teme_km: s.eci, ecf_km: s.ecf }, { accuracy: accuracyNote(o, t).text }, headers);
    }
    if (seg[2] === 'passes') {
      const obs = { lat: num(q.get('lat'), { min: -90, max: 90, name: 'lat' }), lon: num(q.get('lon'), { min: -180, max: 180, name: 'lon' }), height: num(q.get('height') ?? 0, { min: -500, max: 9000, name: 'height' }) };
      const days = num(q.get('days') ?? 3, { min: 0.1, max: 10, name: 'days' }), minEl = num(q.get('min_el') ?? 10, { min: 0, max: 80, name: 'min_el' });
      const res = predictPasses(rec, obs, new Date(), new Date(Date.now() + days * 864e5), { minEl, visibleOnly: q.get('visible_only') === 'true' });
      return ok(res, { observer: obs, note: 'Visible means sunlit object, observer in at least civil twilight. Times from public elements; usually within a minute for a few days ahead.' }, headers);
    }
    if (seg[2] === 'history') {
      need(caller, 'history');
      const from = q.get('from') || new Date(Date.now() - 30 * 864e5).toISOString(), to = q.get('to') || new Date().toISOString();
      const { results } = await env.DB.prepare('SELECT omm FROM element_history WHERE norad = ? AND epoch >= ? AND epoch <= ? ORDER BY epoch LIMIT 2000').bind(o.norad, from.slice(0, 19), to.slice(0, 19)).all();
      return ok(results.map((r) => JSON.parse(r.omm)), { from, to, note: 'Element sets as published by CelesTrak, recorded by Orbitry since the history service began.' }, headers);
    }
  }

  if (seg[0] === 'catalog') {
    need(caller, 'bulk');
    const { objects, raw } = await catalog(env);
    if (!bulkCache || bulkCache.generated !== raw.generated) bulkCache = { generated: raw.generated, body: JSON.stringify({ data: objects.map(publicObject), meta: { attribution: ATTRIBUTION, generated: raw.generated, sources: raw.sources } }) };
    return new Response(bulkCache.body, { headers: { ...CORS, ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=300' } });
  }

  if (seg[0] === 'moon' || seg[0] === 'mars') {
    const d = await asset(env, `${seg[0]}.json`);
    return ok({ sites: d.sites, orbiters: d.orbiters }, { conventions: d.conventions, review: 'Records with review.status "unreviewed" have not yet been checked by a second person.' }, headers);
  }

  if (seg[0] === 'deep-space') {
    const [ss, pr] = await Promise.all([asset(env, 'solar-system.json'), asset(env, 'probes.json')]);
    const t = Date.now(), earth = ephState(ss.bodies.find((b) => b.name === 'Earth')?.v, t);
    const data = pr.probes.map((p) => {
      const b = ss.bodies.find((x) => x.slug === p.slug), s = b && ephState(b.v, t);
      return { slug: p.slug, name: p.name, operator: p.operator, launch_date: p.launch_date, now: s ? { ...ephDescribe(s, earth), heliocentric_ecliptic_au: [s.x, s.y, s.z] } : null, position_note: p.position_note || null };
    });
    return ok(data, { time: new Date(t).toISOString(), source: ss.source, generated: ss.generated }, headers);
  }

  if (seg[0] === 'launches') { const d = await asset(env, 'launches.json'); return ok({ upcoming: d.upcoming, recent: d.recent }, { source: d.source, generated: d.generated }, headers); }
  if (seg[0] === 'reentries') { const d = await asset(env, 'reentries.json'); return ok({ recent: d.recent, low_and_decaying: d.low }, { source: d.source, generated: d.generated, note: 'Orbitry does not predict re-entry times.' }, headers); }

  if (seg[0] === 'alerts') {
    need(caller, 'alerts');
    if (req.method === 'GET') return ok(await listAlerts(env, caller.user.id), {}, headers);
    if (req.method === 'POST') return ok(await createAlert(req, env, caller.user, { viaApi: true }), {}, headers);
    if (req.method === 'DELETE' && seg[1]) return ok(await deleteAlert(env, caller.user.id, seg[1]), {}, headers);
  }

  throw new HttpError(404, 'No such endpoint. See https://orbitry.net/developers/');
}
