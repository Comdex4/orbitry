// Passwordless sign-in: a one-time link by email, then a session cookie.
import { HttpError, json, readJson, cookies, setCookie, sha256, randomToken, nowIso, str } from './http.js';
import { sendEmail, loginEmail } from './email.js';

const SESSION_COOKIE = 'orbitry_session';
const SESSION_DAYS = 30, TOKEN_MINUTES = 20, MAX_LINKS_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-./?=&%#]*$/.test(n) ? n : '/account/');

export async function startLogin(req, env) {
  const body = await readJson(req);
  const email = str(body.email, { max: 320, name: 'email' }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?').bind(email, since).first();
  if (n >= MAX_LINKS_PER_HOUR) throw new HttpError(429, 'Too many sign-in links requested. Try again in an hour.');
  const token = randomToken();
  await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, next, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), email, safeNext(body.next), nowIso(), new Date(Date.now() + TOKEN_MINUTES * 60e3).toISOString()).run();
  const link = `${env.SITE_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(env, { to: email, ...loginEmail(link, TOKEN_MINUTES) });
  return json({ ok: true });
}

// GET shows a confirmation button rather than signing in directly, so link scanners in
// mail systems can't use up the token.
export function verifyPage(req) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — Orbitry</title>
<link rel="stylesheet" href="/css/site.css"><main class="page narrow" style="text-align:center;padding-top:80px"><h1>Sign in to Orbitry</h1>
<p class="lede" style="margin:12px auto 24px">Click the button to finish signing in on this device.</p>
<form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${esc(token)}"><button class="btn primary" type="submit">Sign in</button></form></main>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

export async function verifyLogin(req, env) {
  const form = await req.formData();
  const token = String(form.get('token') || '');
  const row = token && await env.DB.prepare('SELECT * FROM login_tokens WHERE token_hash = ?').bind(await sha256(token)).first();
  if (!row || row.used_at || row.expires_at < nowIso()) {
    return Response.redirect(`${env.SITE_URL}/account/?error=link`, 303);
  }
  const used = await env.DB.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(nowIso(), row.token_hash).run();
  if (!used.meta.changes) return Response.redirect(`${env.SITE_URL}/account/?error=link`, 303);
  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(row.email).first();
  if (!user) {
    user = { id: crypto.randomUUID() };
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(user.id, row.email, nowIso()).run();
  }
  const sid = randomToken();
  await env.DB.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(sid), user.id, nowIso(), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString()).run();
  return new Response(null, { status: 303, headers: { location: env.SITE_URL + safeNext(row.next), 'set-cookie': setCookie(SESSION_COOKIE, sid, { maxAge: SESSION_DAYS * 86400 }) } });
}

export async function sessionUser(req, env) {
  const sid = cookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  return env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?`)
    .bind(await sha256(sid), nowIso()).first();
}

export async function logout(req, env) {
  const sid = cookies(req)[SESSION_COOKIE];
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(sid)).run();
  return json({ ok: true }, { headers: { 'set-cookie': setCookie(SESSION_COOKIE, '', { maxAge: 0 }) } });
}

// Cookie-authenticated writes must come from our own pages.
export function checkOrigin(req, env) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  const allowed = new Set([new URL(env.SITE_URL).origin, new URL(req.url).origin]);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, 'Cross-site request refused');
}

export async function requireUser(req, env) {
  const u = await sessionUser(req, env);
  if (!u) throw new HttpError(401, 'Sign in required');
  checkOrigin(req, env);
  return u;
}

export function publicUser(u) {
  return { email: u.email, created_at: u.created_at, api_plan: u.api_plan, planner: !!u.planner_active };
}
