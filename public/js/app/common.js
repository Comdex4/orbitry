// Shared page chrome (header, footer), data loading and formatting helpers.
import { decodeCatalog } from '../lib/catalog.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6" fill="#5cc8ff"/><ellipse cx="16" cy="16" rx="14" ry="5.5" transform="rotate(-25 16 16)" fill="none" stroke="#e9edf6" stroke-width="1.6"/><circle cx="26.8" cy="8.7" r="2" fill="#ffb454"/></svg>';
const NAV = [
  ['/globe/', 'Globe'], ['/moon/', 'Moon'], ['/mars/', 'Mars'], ['/solar-system/', 'Deep space'],
  ['/launches/', 'Launches'], ['/passes/', 'Passes'], ['/planner/', 'Astro planner'], ['/developers/', 'API']
];

export function chrome({ footer = true } = {}) {
  const here = location.pathname.replace(/index\.html$/, '');
  const header = document.createElement('header');
  header.className = 'top';
  header.innerHTML = `<a class="brand" href="/" aria-label="Orbitry home">${LOGO}<span>Orbitry</span></a>
    <nav aria-label="Primary">${NAV.map(([h, t]) => `<a href="${h}"${h === here ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <a class="btn small acct" href="/account/" id="acct">Sign in</a>`;
  document.body.prepend(header);
  if (footer) {
    const f = document.createElement('footer');
    f.className = 'foot';
    f.innerHTML = `<div class="in"><span>© ${new Date().getFullYear()} Orbitry · an independent project, not affiliated with any space agency</span>
      <span><a href="/about/">Data &amp; accuracy</a> · <a href="/developers/">API</a> · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></span></div>`;
    document.body.append(f);
  }
  session().then(({ server, user }) => {
    const a = $('#acct');
    if (!server) a.hidden = true; // static hosting (e.g. GitHub Pages): no accounts
    else if (user) a.textContent = 'Account';
  });
}

const jsonCache = new Map();
export function getJSON(url, opts) {
  if (!opts && jsonCache.has(url)) return jsonCache.get(url);
  const p = fetch(url, { credentials: 'same-origin', ...opts }).then(async (r) => {
    const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
    if (!r.ok) { const e = new Error(body?.error || `HTTP ${r.status}`); e.status = r.status; e.body = body; throw e; }
    return body;
  });
  if (!opts) { jsonCache.set(url, p); p.catch(() => jsonCache.delete(url)); }
  return p;
}

export function api(path, method = 'GET', body) {
  return getJSON(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
}

// Accounts, alerts and paid plans need the Orbitry Worker. On static hosting such as
// GitHub Pages /api/me doesn't exist, and those features are hidden.
let sessionPromise;
export function session() {
  if (!sessionPromise) sessionPromise = getJSON('/api/me').then((r) => ({ server: true, user: r.user || null })).catch(() => ({ server: false, user: null }));
  return sessionPromise;
}
export const me = () => session().then((s) => s.user);
export const STATIC_NOTE = 'Accounts, email alerts, API keys and paid plans run on the Orbitry server, which isn\'t connected to this copy of the site.';

let catalogPromise;
export function loadCatalog() {
  if (!catalogPromise) catalogPromise = getJSON('/data/catalog.json').then((j) => ({ raw: j, objects: decodeCatalog(j) }));
  return catalogPromise;
}

// "3 h ago", "in 2 d"
export function ago(t, now = Date.now()) {
  const s = (now - +new Date(t)) / 1000, a = Math.abs(s);
  const v = a < 90 ? `${Math.round(a)} s` : a < 5400 ? `${Math.round(a / 60)} min` : a < 172800 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return s >= 0 ? `${v} ago` : `in ${v}`;
}

export const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: d.length === 10 ? 'UTC' : undefined }) : '—');
export const fmtTime = (d, tz) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz });
export const fmtDateTime = (d, tz) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
export const km = (v) => `${Math.round(v).toLocaleString()} km`;
export const utc = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export function fail(el, msg) {
  el.hidden = false; el.classList.add('err');
  el.innerHTML = `<div>${esc(msg)}<br><br><button class="btn" type="button">Try again</button></div>`;
  el.querySelector('button').onclick = () => location.reload();
}

export function reviewChip(r) {
  return r?.review?.status === 'approved'
    ? `<span class="chip ok review" title="Reviewed by ${esc(r.review.by)} on ${esc(r.review.on)}">Reviewed</span>`
    : '<span class="chip warn review" title="This record was compiled from the linked sources and has not yet been checked by a second person.">Awaiting review</span>';
}

export function sourcesList(sources) {
  if (!sources?.length) return '';
  return `<ul class="sources">${sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title || s.name || s.url)}</a>${s.license ? ` <span class="dim">(${esc(s.license)})</span>` : ''}</li>`).join('')}</ul>`;
}

export function photoFigure(p, alt) {
  if (!p) return '';
  const who = [p.author, p.credit && p.credit !== p.author && !/https?:/.test(p.credit) && p.credit.length < 80 ? p.credit : null].filter(Boolean).join(' · ');
  return `<figure><img src="${esc(p.url)}" alt="${esc(alt)}" loading="lazy">
    <figcaption>${who ? esc(who) + ' · ' : ''}${p.license_url ? `<a href="${esc(p.license_url)}" rel="noopener" target="_blank">${esc(p.license)}</a>` : esc(p.license)} · <a href="${esc(p.page)}" rel="noopener" target="_blank">Wikimedia Commons</a></figcaption></figure>`;
}

// Saved location for pass predictions and the planner: account → localStorage → nothing.
export function savedLocation() {
  try { return JSON.parse(localStorage.getItem('orbitry_loc') || 'null'); } catch { return null; }
}
export function rememberLocation(loc) {
  try { localStorage.setItem('orbitry_loc', JSON.stringify(loc)); } catch {}
}

// Place search via Open-Meteo's free geocoding API (no key, CORS enabled).
export async function geocode(q) {
  const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(q)}`);
  return (r.results || []).map((x) => ({ name: [x.name, x.admin1, x.country].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude, height: x.elevation || 0, tz: x.timezone }));
}
