import { chrome, $, $$, esc, session, api, getJSON, geocode, fmtDate, STATIC_NOTE } from './common.js';
import { PLANS } from './plans.js';

chrome();
const main = $('#main'), params = new URLSearchParams(location.search);

function signInView() {
  const err = params.get('error') === 'link' ? '<p class="notice">That sign-in link has expired or was already used. Request a new one below.</p>' : '';
  main.innerHTML = `<h1>Sign in</h1>
    <p class="lede">A free account lets you save locations and favorites and get email alerts before passes. We'll email you a one-time sign-in link; there's no password.</p>${err}
    <form id="f" class="row" style="margin-top:18px"><label class="sr" for="email">Email</label>
      <input id="email" type="email" required autocomplete="email" placeholder="you@example.com" style="flex:1;min-width:240px">
      <button class="btn primary" type="submit">Email me a link</button></form>
    <p id="msg" class="mute" role="status"></p>
    <p class="dim" style="font-size:.84rem;margin-top:24px">We use your email only to sign you in and to send alerts you ask for. See the <a href="/privacy/">privacy notice</a>.</p>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    $('#msg').textContent = 'Sending…';
    try { await api('/api/auth/start', 'POST', { email: $('#email').value, next: params.get('next') || '/account/' }); $('#msg').textContent = 'Check your inbox for a sign-in link. It expires in 20 minutes.'; }
    catch (err) { $('#msg').textContent = err.message === 'HTTP 404' ? 'Accounts are not available on this copy of the site.' : err.message; }
  };
}

const section = (id, title, body) => `<section id="${id}"><h2>${title}</h2>${body}</section>`;

async function accountView(u) {
  const upgraded = params.get('upgraded');
  main.innerHTML = `<h1>Your account</h1>
    <p class="mute">Signed in as <strong>${esc(u.email)}</strong> · member since ${fmtDate(u.created_at)}</p>
    ${upgraded ? `<p class="notice info">Thanks! ${esc(PLANS[upgraded]?.name || 'Your plan')} is being activated; it can take a minute to appear.</p>` : ''}
    ${section('plans', 'Plans', `<div class="cards">${Object.entries(PLANS).map(([k, p]) => {
      const active = k === 'api_pro' ? u.api_plan === 'pro' : u.planner;
      return `<div class="card"><h3 style="margin:0">${esc(p.name)} ${active ? '<span class="chip ok">Active</span>' : ''}</h3><p class="mute" style="font-size:.9rem">${esc(p.blurb)}</p>
        <p><strong>${esc(p.price)}</strong></p>${active ? '<button class="btn small" data-portal type="button">Manage billing</button>' : `<button class="btn small primary" data-buy="${k}" type="button">Subscribe</button>`}</div>`;
    }).join('')}</div><p id="billMsg" class="mute" role="status"></p>`)}
    ${section('locations', 'Saved locations', `<ul class="list" id="locList"></ul>
      <div class="row" style="margin-top:10px;position:relative"><input id="locQ" type="search" placeholder="Add a place" style="flex:1"><ul class="sugg" id="locSugg" hidden style="position:absolute;top:44px;left:0;right:0;z-index:4"></ul></div>`)}
    ${section('favorites', 'Favorites', '<ul class="list" id="favList"></ul>')}
    ${section('alerts', 'Alerts', `<ul class="list" id="alertList"></ul>
      <p class="dim" style="font-size:.84rem">Create pass alerts from the <a href="/passes/">passes page</a>.${u.api_plan === 'pro' ? '' : ' Re-entry alerts are part of API Pro.'}</p>
      ${u.api_plan === 'pro' ? `<form id="reForm" class="row"><input id="reNorad" inputmode="numeric" placeholder="NORAD number" style="width:150px"><input id="reHook" type="url" placeholder="Webhook URL (optional, https)" style="flex:1;min-width:200px"><button class="btn small" type="submit">Alert me on re-entry</button></form><p id="reMsg" class="mute"></p>` : ''}`)}
    ${section('keys', 'API keys', `<p class="mute" style="font-size:.9rem">Tier: <strong>${u.api_plan === 'pro' ? 'API Pro' : 'Free key'}</strong> · <span id="usage">…</span> · <a href="/developers/">API docs</a></p>
      <ul class="list" id="keyList"></ul><div id="newKey"></div>
      <form id="keyForm" class="row" style="margin-top:10px"><input id="keyName" placeholder="Key name (e.g. classroom site)" style="flex:1"><button class="btn small" type="submit">Create key</button></form>`)}
    ${section('danger', 'Account', `<div class="row"><button class="btn" id="out" type="button">Sign out</button><button class="btn ghost" id="del" type="button" style="color:var(--bad)">Delete account</button></div><p id="delMsg" class="mute"></p>`)}`;

  $$('[data-buy]').forEach((b) => (b.onclick = async () => { $('#billMsg').textContent = 'Opening checkout…'; try { location.href = (await api('/api/billing/checkout', 'POST', { plan: b.dataset.buy })).url; } catch (e) { $('#billMsg').textContent = e.message; } }));
  $$('[data-portal]').forEach((b) => (b.onclick = async () => { try { location.href = (await api('/api/billing/portal', 'POST', {})).url; } catch (e) { $('#billMsg').textContent = e.message; } }));
  $('#out').onclick = async () => { await api('/api/auth/logout', 'POST', {}); location.href = '/'; };
  $('#del').onclick = async () => {
    if (!confirm('Delete your account, saved locations, favorites, alerts and API keys? This cannot be undone.')) return;
    try { await api('/api/account', 'DELETE'); location.href = '/'; } catch (e) { $('#delMsg').textContent = e.message; }
  };
  loadLocations(); loadFavs(); loadAlerts(); loadKeys();
  bindLocationAdd();
  if ($('#reForm')) $('#reForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/alerts', 'POST', { kind: 'reentry', norad: +$('#reNorad').value, webhook_url: $('#reHook').value || null }); $('#reMsg').textContent = 'Alert created.'; loadAlerts(); }
    catch (err) { $('#reMsg').textContent = err.message; }
  };
  $('#keyForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const k = await api('/api/keys', 'POST', { name: $('#keyName').value || null });
      $('#newKey').innerHTML = `<p class="notice" style="margin-top:10px">Copy this key now. It won't be shown again.</p><div class="keybox">${esc(k.key)}</div>`;
      $('#keyName').value = ''; loadKeys();
    } catch (err) { $('#newKey').innerHTML = `<p class="notice">${esc(err.message)}</p>`; }
  };
  getJSON('/api/usage', {}).then((us) => { const today = us.days.at(-1); $('#usage').textContent = `${(today?.count || 0).toLocaleString()} of ${us.per_day_limit.toLocaleString()} requests used today (UTC)`; }).catch(() => ($('#usage').textContent = 'usage unavailable'));
}

const del = (list, url, reload) => $$(`${list} [data-del]`).forEach((b) => (b.onclick = async () => { await api(`${url}/${b.dataset.del}`, 'DELETE'); reload(); }));

async function loadLocations() {
  const { locations } = await getJSON('/api/locations', {});
  $('#locList').innerHTML = locations.map((l) => `<li><span class="grow">${esc(l.name)} <span class="dim">${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}</span></span><a class="btn small" href="/passes/">Passes</a><button class="btn small ghost" data-del="${l.id}" type="button">Remove</button></li>`).join('') || '<li class="mute">No saved locations.</li>';
  del('#locList', '/api/locations', loadLocations);
}
function bindLocationAdd() {
  let t;
  $('#locQ').oninput = () => {
    clearTimeout(t); const v = $('#locQ').value.trim();
    if (v.length < 2) { $('#locSugg').hidden = true; return; }
    t = setTimeout(async () => {
      const res = await geocode(v).catch(() => []);
      $('#locSugg').innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join('');
      $('#locSugg').hidden = !res.length;
      $$('#locSugg button').forEach((b) => (b.onclick = async () => { const r = res[+b.dataset.i]; $('#locSugg').hidden = true; $('#locQ').value = ''; await api('/api/locations', 'POST', r); loadLocations(); }));
    }, 250);
  };
}
async function loadFavs() {
  const { favorites } = await getJSON('/api/favorites', {});
  $('#favList').innerHTML = favorites.map((f) => `<li><span class="grow"><a href="/object/?norad=${f.norad}">${esc(f.name || 'NORAD ' + f.norad)}</a> ${f.in_orbit ? '' : '<span class="chip">no longer in the active catalog</span>'}</span><a class="btn small" href="/?norad=${f.norad}">Globe</a><button class="btn small ghost" data-del="${f.norad}" type="button">Remove</button></li>`).join('') || '<li class="mute">No favorites yet. Use ☆ on the globe or an object page.</li>';
  del('#favList', '/api/favorites', loadFavs);
}
async function loadAlerts() {
  const { alerts } = await getJSON('/api/alerts', {});
  $('#alertList').innerHTML = alerts.map((a) => `<li><span class="grow">${a.kind === 'pass' ? `Passes of <strong>${esc(a.name || a.norad)}</strong> over ${esc(a.place || `${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`)}, ${a.lead_minutes} min ahead, above ${a.min_el}°` : `Re-entry of <strong>${esc(a.name || a.norad)}</strong>${a.webhook_url ? ' (email + webhook)' : ''}`} ${a.active ? '' : '<span class="chip">done</span>'}</span><button class="btn small ghost" data-del="${a.id}" type="button">Delete</button></li>`).join('') || '<li class="mute">No alerts.</li>';
  del('#alertList', '/api/alerts', loadAlerts);
}
async function loadKeys() {
  const { keys } = await getJSON('/api/keys', {});
  $('#keyList').innerHTML = keys.map((k) => `<li><span class="grow"><code>${esc(k.prefix)}…</code> ${esc(k.name || '')} <span class="dim">created ${fmtDate(k.created_at)}${k.last_used_at ? ', last used ' + fmtDate(k.last_used_at) : ''}</span></span><button class="btn small ghost" data-del="${k.id}" type="button">Revoke</button></li>`).join('') || '<li class="mute">No keys yet. You can use the API without one at a lower daily limit.</li>';
  del('#keyList', '/api/keys', loadKeys);
}

const { server, user: u } = await session();
if (!server) main.innerHTML = `<h1>Accounts</h1><p class="lede">${esc(STATIC_NOTE)}</p><p>Everything else works without an account: the <a href="/">globe</a>, <a href="/passes/">pass predictions</a>, the <a href="/moon/">Moon</a>, <a href="/mars/">Mars</a> and <a href="/solar-system/">deep space</a>.</p>`;
else u ? accountView(u) : signInView();
