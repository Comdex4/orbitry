import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/index.js';
import { passAlerts, reentryAlerts, plannerNightly } from '../src/worker/cron.js';
import { verifyStripeSignature } from '../src/worker/billing.js';
import { makeEnv, captureEmails, fixtureJson } from './helpers.js';
import { decodeCatalog, epochMs } from '../public/js/lib/catalog.js';
import { satrecFor } from '../public/js/lib/orbit.js';
import { predictPasses } from '../public/js/lib/passes.js';

const SITE = 'https://orbitry.test';
const call = (env, path, { method = 'GET', body, cookie, origin = SITE, headers = {} } = {}) =>
  worker.fetch(new Request(SITE + path, { method, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(origin && method !== 'GET' ? { origin } : {}), ...headers } }), env);

async function signIn(env, email = 'person@example.com') {
  const mails = await captureEmails(() => call(env, '/api/auth/start', { method: 'POST', body: { email, next: '/passes/' } }));
  const token = decodeURIComponent(/token=([^\s]+)/.exec(mails[0])[1]);
  const res = await worker.fetch(new Request(SITE + '/api/auth/verify', { method: 'POST', body: new URLSearchParams({ token }) }), env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), SITE + '/passes/');
  return { cookie: res.headers.get('set-cookie').split(';')[0], token };
}

test('sign-in by email link, single use, then session', async () => {
  const env = makeEnv();
  assert.deepEqual(await (await call(env, '/api/me')).json(), { user: null });
  const { cookie, token } = await signIn(env);
  const again = await worker.fetch(new Request(SITE + '/api/auth/verify', { method: 'POST', body: new URLSearchParams({ token }) }), env);
  assert.match(again.headers.get('location'), /error=link/);
  const me = await (await call(env, '/api/me', { cookie })).json();
  assert.equal(me.user.email, 'person@example.com');
  assert.equal(me.user.api_plan, 'free');
  const out = await call(env, '/api/auth/logout', { method: 'POST', cookie, body: {} });
  assert.equal(out.status, 200);
  assert.deepEqual(await (await call(env, '/api/me', { cookie })).json(), { user: null });
});

test('sign-in links are rate limited and validated', async () => {
  const env = makeEnv();
  assert.equal((await call(env, '/api/auth/start', { method: 'POST', body: { email: 'nope' } })).status, 400);
  await captureEmails(async () => { for (let i = 0; i < 5; i++) await call(env, '/api/auth/start', { method: 'POST', body: { email: 'a@b.co' } }); });
  assert.equal((await call(env, '/api/auth/start', { method: 'POST', body: { email: 'a@b.co' } })).status, 429);
});

test('account features require a session and same-origin writes', async () => {
  const env = makeEnv();
  assert.equal((await call(env, '/api/locations')).status, 401);
  const { cookie } = await signIn(env);
  assert.equal((await call(env, '/api/locations', { method: 'POST', cookie, origin: 'https://evil.example', body: { name: 'x', lat: 1, lon: 1 } })).status, 403);
  const loc = await (await call(env, '/api/locations', { method: 'POST', cookie, body: { name: 'Denver', lat: 39.74, lon: -104.99 } })).json();
  assert.equal(loc.name, 'Denver');
  assert.equal((await call(env, '/api/locations', { method: 'POST', cookie, body: { name: 'Bad', lat: 123, lon: 0 } })).status, 400);
  await call(env, '/api/favorites/25544', { method: 'PUT', cookie });
  const favs = await (await call(env, '/api/favorites', { cookie })).json();
  assert.equal(favs.favorites[0].name, 'ISS (ZARYA)');
  const alert = await (await call(env, '/api/alerts', { method: 'POST', cookie, body: { kind: 'pass', norad: 25544, lat: 39.74, lon: -104.99, place: 'Denver' } })).json();
  assert.equal(alert.kind, 'pass');
  assert.equal((await call(env, '/api/alerts', { method: 'POST', cookie, body: { kind: 'reentry', norad: 25544 } })).status, 403);
  assert.equal((await call(env, `/api/alerts/${alert.id}`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await call(env, `/api/locations/${loc.id}`, { method: 'DELETE', cookie })).status, 200);
});

test('public API: tiers, quotas, keys and Pro-only endpoints', async () => {
  const env = makeEnv();
  const r = await call(env, '/api/v1/objects/25544');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-orbitry-tier'), 'anonymous');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const j = await r.json();
  assert.equal(j.data.name, 'ISS (ZARYA)');
  assert.match(j.meta.attribution, /Orbitry/);
  assert.equal((await call(env, '/api/v1/objects/1')).status, 404);
  const list = await (await call(env, '/api/v1/objects?q=starlink&limit=2')).json();
  assert.equal(list.data.length, 2);
  assert.ok(list.meta.total >= 2);
  assert.equal((await call(env, '/api/v1/catalog')).status, 403);
  assert.equal((await call(env, '/api/v1/objects?limit=9999')).status, 400);

  const { cookie } = await signIn(env);
  const { key } = await (await call(env, '/api/keys', { method: 'POST', cookie, body: { name: 'test' } })).json();
  const keyed = await call(env, '/api/v1/launches', { headers: { authorization: `Bearer ${key}` } });
  assert.equal(keyed.headers.get('x-orbitry-tier'), 'free');
  assert.equal((await call(env, '/api/v1/objects/25544', { headers: { 'x-api-key': 'orb_wrong' } })).status, 401);

  env.DB.raw.exec("UPDATE users SET api_plan = 'pro'");
  const bulk = await call(env, '/api/v1/catalog', { headers: { 'x-api-key': key } });
  assert.equal(bulk.status, 200);
  assert.equal((await bulk.json()).data.length, fixtureJson('catalog.json').rows.length);
  const al = await call(env, '/api/v1/alerts', { method: 'POST', headers: { 'x-api-key': key }, body: { kind: 'reentry', norad: 25544, webhook_url: 'http://insecure.example' } });
  assert.equal(al.status, 400);

  // Quota: push the anonymous counter to the limit.
  env.DB.raw.exec("UPDATE usage SET count = 500 WHERE subject LIKE 'ip:%'");
  const over = await call(env, '/api/v1/launches');
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('access-control-allow-origin'), '*');
});

test('passes, position, Moon/Mars and deep-space endpoints', async () => {
  const env = makeEnv();
  const iss = decodeCatalog(fixtureJson('catalog.json')).find((o) => o.norad === 25544);
  const pos = await (await call(env, `/api/v1/objects/25544/position?t=${new Date(epochMs(iss.epoch)).toISOString()}`)).json();
  assert.ok(pos.data.alt_km > 380 && pos.data.alt_km < 460);
  assert.equal((await call(env, '/api/v1/objects/25544/position?t=1990-01-01T00:00:00Z')).status, 422);
  assert.equal((await call(env, '/api/v1/objects/25544/passes?lat=95&lon=0')).status, 400);
  const moon = await (await call(env, '/api/v1/moon')).json();
  assert.ok(moon.data.sites.some((s) => s.slug === 'apollo-11'));
  const ds = await (await call(env, '/api/v1/deep-space')).json();
  assert.ok(ds.data.find((p) => p.slug === 'voyager-1'));
});

test('pass alert emails once, shortly before a visible pass', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const iss = decodeCatalog(fixtureJson('catalog.json')).find((o) => o.norad === 25544);
  const t0 = epochMs(iss.epoch);
  // Find a site and time with a visible pass in the fixture's validity window.
  const sites = [[39.74, -104.99], [51.5, 0], [-33.9, 151.2], [35.7, 139.7], [40.7, -74], [-23.5, -46.6], [19.4, -99.1], [55.7, 37.6]];
  let found = null;
  for (const [lat, lon] of sites) {
    const p = predictPasses(satrecFor(iss), { lat, lon }, new Date(t0), new Date(t0 + 3 * 864e5), { minEl: 20, visibleOnly: true }).passes[0];
    if (p) { found = { lat, lon, p }; break; }
  }
  assert.ok(found, 'expected a visible ISS pass somewhere within three days');
  await call(env, '/api/alerts', { method: 'POST', cookie, body: { kind: 'pass', norad: 25544, lat: found.lat, lon: found.lon, place: 'Testville', tz: 'UTC', min_el: 20, lead_minutes: 60 } });
  const now = +found.p.visibleFrom.time - 30 * 60000;
  let n;
  const mails = await captureEmails(async () => { n = await passAlerts(env, now); });
  assert.equal(n, 1);
  assert.match(mails[0], /ISS \(ZARYA\) passes over Testville/);
  const again = await captureEmails(async () => { n = await passAlerts(env, now + 15 * 60000); });
  assert.equal(n, 0);
  assert.equal(again.length, 0);
});

test('re-entry alert fires once and deactivates', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  env.DB.raw.exec("UPDATE users SET api_plan = 'pro'");
  // Re-entry alerts can only be created for objects in orbit; simulate one that later re-enters.
  const gone = fixtureJson('reentries.json').recent[0];
  const { id } = await (await call(env, '/api/alerts', { method: 'POST', cookie, body: { kind: 'reentry', norad: 25544 } })).json();
  env.DB.raw.prepare('UPDATE alerts SET norad = ? WHERE id = ?').run(gone.norad, id);
  let n;
  const mails = await captureEmails(async () => { n = await reentryAlerts(env); });
  assert.equal(n, 1);
  assert.match(mails[0], /has re-entered/);
  assert.equal(await reentryAlerts(env), 0);
});

test('planner nightly email goes out once per local day', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  assert.equal((await call(env, '/api/planner', { method: 'PUT', cookie, body: {} })).status, 403);
  env.DB.raw.exec('UPDATE users SET planner_active = 1');
  const profile = { location: { name: 'Denver', lat: 39.74, lon: -104.99, tz: 'America/Denver' }, equipment: { focal_mm: 135, sensor_w_mm: 23.5, sensor_h_mm: 15.6 }, min_alt: 25, horizon: [0, 0, 0, 0, 0, 0, 0, 0], email_nightly: true };
  assert.equal((await call(env, '/api/planner', { method: 'PUT', cookie, body: profile })).status, 200);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 }); // no network: weather unavailable
  try {
    const at = Date.parse('2026-10-09T23:00:00Z'); // 17:00 in Denver
    let n;
    const mails = await captureEmails(async () => { n = await plannerNightly(env, at); });
    assert.equal(n, 1);
    assert.match(mails[0], /Tonight's sky/);
    assert.equal(await plannerNightly(env, at + 3600e3), 0);
    assert.equal(await plannerNightly(env, Date.parse('2026-10-10T15:00:00Z')), 0); // 09:00 next day: too early
  } finally { globalThis.fetch = realFetch; }
});

test('Stripe webhook signatures', async () => {
  const secret = 'whsec_test', payload = '{"type":"x"}', t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret), true);
  assert.equal(await verifyStripeSignature(payload + ' ', `t=${t},v1=${sig}`, secret), false);
  assert.equal(await verifyStripeSignature(payload, `t=${t - 3600},v1=${sig}`, secret), false);

  const env = makeEnv({ STRIPE_WEBHOOK_SECRET: secret });
  const { cookie } = await signIn(env);
  const uid = env.DB.raw.prepare('SELECT id FROM users').get().id;
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: uid, customer: 'cus_1', metadata: { plan: 'planner' } } } });
  const s2 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${event}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const r = await worker.fetch(new Request(SITE + '/api/billing/webhook', { method: 'POST', body: event, headers: { 'stripe-signature': `t=${t},v1=${s2}` } }), env);
  assert.equal(r.status, 200);
  assert.equal((await (await call(env, '/api/me', { cookie })).json()).user.planner, true);
  assert.equal((await call(env, '/api/account', { method: 'DELETE', cookie })).status, 409);
});
