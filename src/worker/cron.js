// Scheduled jobs: pass alerts, re-entry alerts and the planner's nightly email.
import { catalog, asset } from './data.js';
import { sendEmail, passEmail, reentryEmail, plannerEmail } from './email.js';
import { satrecFor } from '../../public/js/lib/orbit.js';
import { predictPasses } from '../../public/js/lib/passes.js';
import { fetchWeather, planNight } from '../../public/js/lib/planner.js';
import { fieldOfView } from '../../public/js/lib/streaks.js';

async function sentRecently(env, alertId, sinceMs) {
  return env.DB.prepare('SELECT 1 FROM alert_sends WHERE alert_id = ? AND sent_at > ? LIMIT 1').bind(alertId, new Date(sinceMs).toISOString()).first();
}
const markSent = (env, alertId, key, at = Date.now()) => env.DB.prepare('INSERT OR IGNORE INTO alert_sends (alert_id, event_key, sent_at) VALUES (?, ?, ?)').bind(alertId, key, new Date(at).toISOString()).run();

// Email shortly before each visible pass, at most once per pass.
export async function passAlerts(env, now = Date.now()) {
  const { results } = await env.DB.prepare(`SELECT a.*, u.email FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.kind = 'pass' AND a.active = 1`).all();
  if (!results.length) return 0;
  const { byNorad } = await catalog(env);
  let sent = 0;
  for (const a of results) {
    const o = byNorad.get(a.norad), rec = o && satrecFor(o);
    if (!rec) continue;
    const { passes } = predictPasses(rec, { lat: a.lat, lon: a.lon, height: a.height }, new Date(now), new Date(now + (a.lead_minutes + 30) * 60000), { minEl: a.min_el, visibleOnly: true });
    for (const p of passes) {
      const start = p.visibleFrom.time, lead = +start - now;
      if (lead <= 0 || lead > a.lead_minutes * 60000) continue;
      // Predictions shift a little as elements update; one email per 45 minutes covers one pass.
      if (await sentRecently(env, a.id, now - 45 * 60000)) continue;
      await sendEmail(env, { to: a.email, ...passEmail(env.SITE_URL, { name: o.name, place: a.place, tz: a.tz, norad: a.norad, pass: { start: p.visibleFrom, max: p.visibleMax || p.max, end: p.visibleTo, magnitude: p.magnitude } }) });
      await markSent(env, a.id, `pass:${Math.round(+start / 60000)}`, now);
      sent++;
    }
  }
  return sent;
}

// Notify (email and optional webhook) when a watched object is recorded as re-entered.
export async function reentryAlerts(env) {
  const { results } = await env.DB.prepare(`SELECT a.*, u.email FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.kind = 'reentry' AND a.active = 1`).all();
  if (!results.length) return 0;
  const re = await asset(env, 'reentries.json'), byNorad = new Map(re.recent.map((r) => [r.norad, r]));
  let sent = 0;
  for (const a of results) {
    const r = byNorad.get(a.norad);
    if (!r) continue;
    await sendEmail(env, { to: a.email, ...reentryEmail(env.SITE_URL, r) });
    if (a.webhook_url) {
      await fetch(a.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Orbitry-Alerts/1.0' }, body: JSON.stringify({ type: 'reentry', alert_id: a.id, object: r }) })
        .catch((e) => console.warn('webhook failed', a.id, e.message));
    }
    await markSent(env, a.id, `reentry:${a.norad}`);
    await env.DB.prepare('UPDATE alerts SET active = 0 WHERE id = ?').bind(a.id).run();
    sent++;
  }
  return sent;
}

function localParts(tz, t) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// Send each planner subscriber tonight's plan at about 4 pm their time.
export async function plannerNightly(env, now = Date.now()) {
  const { results } = await env.DB.prepare(`SELECT p.*, u.email FROM planner_profiles p JOIN users u ON u.id = p.user_id WHERE p.email_nightly = 1 AND u.planner_active = 1`).all();
  if (!results.length) return 0;
  const { targets } = await asset(env, 'targets.json');
  let sent = 0;
  for (const r of results) {
    const prof = JSON.parse(r.profile), tz = prof.location.tz || 'UTC', lp = localParts(tz, now);
    if (lp.hour < 16 || r.last_sent_day === lp.day) continue;
    try {
      const weather = await fetchWeather(prof.location.lat, prof.location.lon).catch(() => null);
      const fov = fieldOfView(prof.equipment.focal_mm, prof.equipment.sensor_w_mm, prof.equipment.sensor_h_mm);
      const plan = planNight(prof.location, new Date(now), { targets, weather, horizon: prof.horizon, minAlt: prof.min_alt, fov });
      const t = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
      await sendEmail(env, {
        to: r.email, ...plannerEmail(env.SITE_URL, {
          place: prof.location.name || `${prof.location.lat.toFixed(2)}, ${prof.location.lon.toFixed(2)}`, verdict: plan.verdict,
          dark: plan.window ? { start: t(plan.window.start), end: t(plan.window.end) } : null,
          moon: `${plan.moon.name}, ${Math.round(plan.moon.fraction * 100)}% lit${plan.moon.upFraction > 0 ? `, up for ${Math.round(plan.moon.upFraction * 100)}% of the dark hours` : ', below the horizon while dark'}`,
          clouds: plan.meanCloud == null ? 'forecast unavailable' : `${Math.round(plan.meanCloud)}% average cover while dark`,
          targets: plan.targets.map((x) => ({ name: x.name, best: x.best ? t(x.best) : '—', alt: x.maxAlt, note: x.note }))
        })
      });
      await env.DB.prepare('UPDATE planner_profiles SET last_sent_day = ? WHERE user_id = ?').bind(lp.day, r.user_id).run();
      sent++;
    } catch (e) { console.error('planner email failed', r.user_id, e.message); }
  }
  return sent;
}

export async function runScheduled(env, now = Date.now()) {
  const out = {};
  for (const [name, job] of Object.entries({ passAlerts, reentryAlerts, plannerNightly })) {
    try { out[name] = await job(env, now); } catch (e) { console.error(name, e); out[name] = `error: ${e.message}`; }
  }
  return out;
}
