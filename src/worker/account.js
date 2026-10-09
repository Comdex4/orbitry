// Signed-in features: saved locations, favorites, alerts, API keys, usage and planner settings.
import { HttpError, json, readJson, num, str, nowIso, randomToken, sha256 } from './http.js';
import { LIMITS, API_TIERS } from './plans.js';
import { catalog } from './data.js';
import { publicUser } from './auth.js';

async function count(env, table, userId, extra = '', ...binds) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? ${extra}`).bind(userId, ...binds).first();
  return r.n;
}

/* locations */
export async function listLocations(env, userId) {
  const { results } = await env.DB.prepare('SELECT id, name, lat, lon, height, tz FROM locations WHERE user_id = ? ORDER BY created_at').bind(userId).all();
  return results;
}
export async function addLocation(req, env, user) {
  const b = await readJson(req);
  if (await count(env, 'locations', user.id) >= LIMITS.locations) throw new HttpError(400, `You can save up to ${LIMITS.locations} locations.`);
  const loc = {
    id: crypto.randomUUID(), name: str(b.name, { max: 80, name: 'name' }), lat: num(b.lat, { min: -90, max: 90, name: 'lat' }), lon: num(b.lon, { min: -180, max: 180, name: 'lon' }),
    height: num(b.height ?? 0, { min: -500, max: 9000, name: 'height' }), tz: str(b.tz, { max: 60, name: 'tz', required: false })
  };
  await env.DB.prepare('INSERT INTO locations (id, user_id, name, lat, lon, height, tz, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(loc.id, user.id, loc.name, loc.lat, loc.lon, loc.height, loc.tz, nowIso()).run();
  return loc;
}

/* favorites */
export async function listFavorites(env, userId) {
  const { results } = await env.DB.prepare('SELECT norad, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all();
  const { byNorad } = await catalog(env).catch(() => ({ byNorad: new Map() }));
  return results.map((r) => ({ ...r, name: byNorad.get(r.norad)?.name || null, in_orbit: byNorad.has(r.norad) }));
}
export async function setFavorite(env, user, norad, on) {
  const n = num(norad, { min: 1, max: 999999999, name: 'NORAD number' });
  if (on) {
    if (await count(env, 'favorites', user.id) >= LIMITS.favorites) throw new HttpError(400, `You can keep up to ${LIMITS.favorites} favorites.`);
    await env.DB.prepare('INSERT OR IGNORE INTO favorites (user_id, norad, created_at) VALUES (?, ?, ?)').bind(user.id, n, nowIso()).run();
  } else await env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND norad = ?').bind(user.id, n).run();
  return { norad: n, favorite: on };
}

/* alerts */
export async function listAlerts(env, userId) {
  const { results } = await env.DB.prepare('SELECT id, kind, norad, lat, lon, place, tz, min_el, lead_minutes, webhook_url, active, created_at FROM alerts WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all();
  const { byNorad } = await catalog(env).catch(() => ({ byNorad: new Map() }));
  return results.map((a) => ({ ...a, name: byNorad.get(a.norad)?.name || null }));
}

export async function createAlert(req, env, user, { viaApi = false } = {}) {
  const b = await readJson(req);
  const kind = b.kind === 'reentry' ? 'reentry' : b.kind === 'pass' ? 'pass' : null;
  if (!kind) throw new HttpError(400, 'kind must be "pass" or "reentry"');
  const norad = num(b.norad, { min: 1, max: 999999999, name: 'norad' });
  const { byNorad } = await catalog(env);
  if (!byNorad.has(norad)) throw new HttpError(404, `NORAD ${norad} is not in the current catalog of objects in orbit.`);
  const a = { id: crypto.randomUUID(), kind, norad, lat: null, lon: null, height: null, place: null, tz: null, min_el: 20, lead_minutes: 60, webhook_url: null };
  if (kind === 'pass') {
    if (viaApi) throw new HttpError(400, 'Pass alerts are created from the website.');
    if (await count(env, 'alerts', user.id, "AND kind = 'pass'") >= LIMITS.passAlerts) throw new HttpError(400, `You can have up to ${LIMITS.passAlerts} pass alerts.`);
    Object.assign(a, {
      lat: num(b.lat, { min: -90, max: 90, name: 'lat' }), lon: num(b.lon, { min: -180, max: 180, name: 'lon' }), height: num(b.height ?? 0, { min: -500, max: 9000, name: 'height' }),
      place: str(b.place, { max: 120, name: 'place', required: false }), tz: str(b.tz, { max: 60, name: 'tz', required: false }),
      min_el: num(b.min_el ?? 20, { min: 10, max: 80, name: 'min_el' }), lead_minutes: num(b.lead_minutes ?? 60, { min: 15, max: 720, name: 'lead_minutes' })
    });
  } else {
    if (!API_TIERS[user.api_plan === 'pro' ? 'pro' : 'free'].alerts) throw new HttpError(403, 'Re-entry alerts are part of API Pro.');
    if (await count(env, 'alerts', user.id, "AND kind = 'reentry'") >= LIMITS.reentryAlerts) throw new HttpError(400, `You can have up to ${LIMITS.reentryAlerts} re-entry alerts.`);
    if (b.webhook_url != null && b.webhook_url !== '') {
      const u = str(b.webhook_url, { max: 500, name: 'webhook_url' });
      let parsed; try { parsed = new URL(u); } catch { throw new HttpError(400, 'webhook_url must be a valid URL'); }
      if (parsed.protocol !== 'https:') throw new HttpError(400, 'webhook_url must use https');
      a.webhook_url = u;
    }
  }
  await env.DB.prepare('INSERT INTO alerts (id, user_id, kind, norad, lat, lon, height, place, tz, min_el, lead_minutes, webhook_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
    .bind(a.id, user.id, a.kind, a.norad, a.lat, a.lon, a.height, a.place, a.tz, a.min_el, a.lead_minutes, a.webhook_url, nowIso()).run();
  return { ...a, name: byNorad.get(norad).name };
}

export async function deleteAlert(env, userId, id) {
  const r = await env.DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (!r.meta.changes) throw new HttpError(404, 'No such alert');
  return { deleted: id };
}

/* API keys: the full key is shown once; only a hash is stored. */
export async function listKeys(env, userId) {
  const { results } = await env.DB.prepare('SELECT id, prefix, name, created_at, last_used_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at').bind(userId).all();
  return results;
}
export async function createKey(req, env, user) {
  const b = await readJson(req);
  if (await count(env, 'api_keys', user.id, 'AND revoked_at IS NULL') >= LIMITS.keys) throw new HttpError(400, `You can have up to ${LIMITS.keys} active keys.`);
  const key = 'orb_' + randomToken(24), id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, prefix, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, await sha256(key), key.slice(0, 10), str(b.name, { max: 60, name: 'name', required: false }), nowIso()).run();
  return { id, key, prefix: key.slice(0, 10), note: 'Copy this key now; it will not be shown again.' };
}
export async function revokeKey(env, userId, id) {
  const r = await env.DB.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(nowIso(), id, userId).run();
  if (!r.meta.changes) throw new HttpError(404, 'No such key');
  return { revoked: id };
}

export async function usage(env, user) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT u.day, SUM(u.count) AS count FROM usage u JOIN api_keys k ON u.subject = 'key:' || k.id
    WHERE k.user_id = ? AND u.day >= ? GROUP BY u.day ORDER BY u.day`).bind(user.id, since).all();
  const tier = user.api_plan === 'pro' ? 'pro' : 'free';
  return { tier, per_day_limit: API_TIERS[tier].perDay, days: results };
}

/* planner profile (location, equipment, horizon, email preference) */
export async function getPlanner(env, user) {
  const r = await env.DB.prepare('SELECT profile, email_nightly FROM planner_profiles WHERE user_id = ?').bind(user.id).first();
  return r ? { ...JSON.parse(r.profile), email_nightly: !!r.email_nightly } : null;
}
export async function savePlanner(req, env, user) {
  if (!user.planner_active) throw new HttpError(403, 'The planner needs a planner subscription.');
  const b = await readJson(req);
  const profile = {
    location: { name: str(b.location?.name, { max: 120, name: 'location name', required: false }), lat: num(b.location?.lat, { min: -90, max: 90, name: 'lat' }), lon: num(b.location?.lon, { min: -180, max: 180, name: 'lon' }), height: num(b.location?.height ?? 0, { min: -500, max: 9000, name: 'height' }), tz: str(b.location?.tz, { max: 60, name: 'tz', required: false }) },
    equipment: { focal_mm: num(b.equipment?.focal_mm, { min: 5, max: 10000, name: 'focal length' }), sensor_w_mm: num(b.equipment?.sensor_w_mm, { min: 1, max: 100, name: 'sensor width' }), sensor_h_mm: num(b.equipment?.sensor_h_mm, { min: 1, max: 100, name: 'sensor height' }) },
    min_alt: num(b.min_alt ?? 20, { min: 0, max: 80, name: 'minimum altitude' }),
    horizon: Array.isArray(b.horizon) ? b.horizon.slice(0, 16).map((v) => num(v, { min: 0, max: 80, name: 'horizon' })) : null
  };
  await env.DB.prepare(`INSERT INTO planner_profiles (user_id, profile, email_nightly, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET profile = excluded.profile, email_nightly = excluded.email_nightly, updated_at = excluded.updated_at`)
    .bind(user.id, JSON.stringify(profile), b.email_nightly ? 1 : 0, nowIso()).run();
  return { ...profile, email_nightly: !!b.email_nightly };
}

export async function deleteAccount(env, user) {
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  return json({ deleted: true }, { headers: { 'set-cookie': 'orbitry_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
}

export { publicUser };
