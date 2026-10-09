import { chrome, $, $$, esc, loadCatalog, geocode, savedLocation, rememberLocation, session, getJSON, api, fmtDateTime, fmtTime } from './common.js';
import { satrecFor } from '../lib/orbit.js';
import { predictPasses, look, observerGd } from '../lib/passes.js';
import { launchGroup } from '../lib/catalog.js';

chrome();
const params = new URLSearchParams(location.search);
let loc = savedLocation(), target = params.get('norad') || '25544', objects = [], user = null, server = false;

function showLoc() {
  $('#locNow').innerHTML = loc ? `Showing passes for <strong>${esc(loc.name || 'your location')}</strong> <span class="dim">(${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)})</span>` : 'No location set.';
}

function setLoc(l) { loc = l; rememberLocation(l); showLoc(); run(); }

/* location search */
let lt;
$('#locQ').addEventListener('input', () => {
  clearTimeout(lt);
  const v = $('#locQ').value.trim();
  if (v.length < 2) { $('#locSugg').hidden = true; return; }
  lt = setTimeout(async () => {
    try {
      const res = await geocode(v);
      $('#locSugg').innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join('');
      $('#locSugg').hidden = !res.length;
      $$('#locSugg button').forEach((b) => (b.onclick = () => { setLoc(res[+b.dataset.i]); $('#locSugg').hidden = true; $('#locQ').value = ''; }));
    } catch { $('#locSugg').hidden = true; }
  }, 250);
});
$('#geo').onclick = () => {
  if (!navigator.geolocation) return;
  $('#geo').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (p) => { $('#geo').textContent = 'Use my location'; setLoc({ name: 'Your location', lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), height: p.coords.altitude || 0 }); },
    () => { $('#geo').textContent = 'Location unavailable'; }, { timeout: 10000, maximumAge: 600000 });
};

/* target */
function pickTarget(t) {
  target = String(t);
  $$('#targets button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === target)));
  const p = new URLSearchParams(location.search); p.set('norad', target); history.replaceState(null, '', '?' + p);
  run();
}
$$('#targets button').forEach((b) => (b.onclick = () => pickTarget(b.dataset.t)));
$('#satQ').addEventListener('input', () => {
  const v = $('#satQ').value.trim().toLowerCase();
  if (v.length < 2) { $('#satSugg').hidden = true; return; }
  const hits = objects.filter((o) => String(o.norad) === v || o.name.toLowerCase().includes(v)).slice(0, 8);
  $('#satSugg').innerHTML = hits.map((o) => `<li><button type="button" data-n="${o.norad}">${esc(o.name)} <small>· ${o.norad}</small></button></li>`).join('');
  $('#satSugg').hidden = !hits.length;
  $$('#satSugg button').forEach((b) => (b.onclick = () => { $('#satSugg').hidden = true; $('#satQ').value = ''; pickTarget(b.dataset.n); }));
});
$('#visOnly').onchange = run; $('#days').onchange = run;

// Polar sky plot: zenith in the middle, horizon at the edge, north up, east left (as seen looking up).
function skyPlot(path) {
  const R = 60, c = 70, P = (az, el) => { const r = R * (1 - Math.max(0, el) / 90), a = az * Math.PI / 180; return [c - r * Math.sin(a), c - r * Math.cos(a)]; };
  const pts = path.map((p) => P(p.az, p.el).map((v) => v.toFixed(1)).join(',')).join(' ');
  const [sx, sy] = P(path[0].az, path[0].el), [ex, ey] = P(path.at(-1).az, path.at(-1).el);
  return `<svg class="sky" viewBox="0 0 140 140" role="img" aria-label="Sky path"><circle cx="70" cy="70" r="60"/><circle cx="70" cy="70" r="40"/><circle cx="70" cy="70" r="20"/>
    <line x1="70" y1="10" x2="70" y2="130"/><line x1="10" y1="70" x2="130" y2="70"/>
    <text x="67" y="8">N</text><text x="0" y="73">E</text><text x="132" y="73">W</text><text x="67" y="139">S</text>
    <polyline points="${pts}" fill="none" stroke="#5cc8ff" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${sx}" cy="${sy}" r="3" fill="#6be3a4" stroke="none"/><circle cx="${ex}" cy="${ey}" r="3" fill="#ff5fa2" stroke="none"/></svg>`;
}

function samplePath(rec, p) {
  const out = [], a = +p.rise.time, b = +p.set.time, gd = observerGd(loc);
  for (let i = 0; i <= 24; i++) { const l = look(rec, new Date(a + (b - a) * i / 24), gd); if (l) out.push(l); }
  return out;
}

function passCard(name, p, rec, extra = '') {
  const tz = loc.tz;
  const dir = (x) => `${x.dir} · ${Math.round(x.el)}°`;
  const s = p.visibleFrom || p.rise, e = p.visibleTo || p.set;
  return `<div class="pass">${skyPlot(samplePath(rec, p))}<div class="t">
    <h3>${esc(fmtDateTime(s.time, tz))} ${p.visible ? '<span class="chip ok">Visible</span>' : '<span class="chip">Not visible (daylight or in shadow)</span>'} ${p.magnitude != null ? `<span class="chip blue" title="Estimated visual magnitude; lower is brighter">mag ${p.magnitude.toFixed(1)}</span>` : ''}</h3>
    <div class="mute" style="font-size:.86rem">${esc(name)}${extra} · ${Math.round(p.duration / 60)} min above the horizon</div>
    <div class="steps"><div><b>${p.visibleFrom ? 'Appears' : 'Rises'}</b>${fmtTime(s.time, tz)} · ${dir(s)}</div><div><b>Highest${p.visibleMax && p.visibleMax.el < p.max.el - 1 ? ' while visible' : ''}</b>${fmtTime((p.visibleMax || p.max).time, tz)} · ${dir(p.visibleMax || p.max)}</div><div><b>${p.visibleTo ? 'Disappears' : 'Sets'}</b>${fmtTime(e.time, tz)} · ${dir(e)}</div></div>
  </div></div>`;
}

function trains() {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), groups = new Map();
  for (const o of objects) if (/^STARLINK/.test(o.name) && o.launch && o.launch >= cutoff) {
    const g = launchGroup(o.intl); if (!g) continue;
    (groups.get(g) || groups.set(g, []).get(g)).push(o);
  }
  return [...groups.entries()].filter(([, l]) => l.length >= 5).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

async function run() {
  const out = $('#results');
  if (!loc) { out.innerHTML = '<p class="mute">Set a location to see passes.</p>'; return; }
  if (!objects.length) return;
  const days = +$('#days').value, start = new Date(), end = new Date(Date.now() + days * 864e5), vis = $('#visOnly').checked;
  out.innerHTML = '<p class="mute">Calculating…</p>';
  await new Promise((r) => setTimeout(r, 20));
  renderAlert();
  if (target === 'trains') {
    $('#resTitle').textContent = 'Starlink trains';
    const ts = trains();
    if (!ts.length) { out.innerHTML = '<p class="mute">No Starlink batch launched in the last 30 days is in the catalog right now. Trains are easiest to see in the first days after launch.</p>'; return; }
    let html = '';
    for (const [g, list] of ts) {
      // A pass of the train: passes of all members, clustered when they overlap in time.
      const all = list.flatMap((o) => { const r = satrecFor(o); return r ? predictPasses(r, loc, start, end, { minEl: 10 }).passes.map((p) => ({ p, r })) : []; }).sort((a, b) => a.p.rise.time - b.p.rise.time);
      const clusters = [];
      for (const x of all) { const c = clusters.at(-1); if (c && +x.p.rise.time - +c.end < 5 * 60000) { c.items.push(x); c.end = Math.max(c.end, +x.p.set.time); } else clusters.push({ items: [x], end: +x.p.set.time }); }
      const shown = clusters.filter((c) => !vis || c.items.some((x) => x.p.visible)).slice(0, 12);
      html += `<h3 style="margin-top:22px">Launch ${esc(g)} <span class="dim">· ${list.length} satellites · launched ${esc(list[0].launch)}</span></h3>`;
      html += shown.map((c) => { const lead = c.items.find((x) => x.p.visible) || c.items[0]; return passCard(`Starlink train (${g})`, lead.p, lead.r, ` · ${c.items.length} satellite${c.items.length === 1 ? '' : 's'} over ${Math.round((c.end - +c.items[0].p.rise.time) / 60000)} min`); }).join('') || `<p class="mute">No ${vis ? 'visible ' : ''}passes in the next ${days} days.</p>`;
    }
    out.innerHTML = html;
    return;
  }
  const o = objects.find((x) => String(x.norad) === target);
  if (!o) { out.innerHTML = '<p class="mute">That object isn\'t in the current catalog.</p>'; return; }
  $('#resTitle').innerHTML = `Passes of ${esc(o.name)} <a class="btn small" href="/object/?norad=${o.norad}" style="vertical-align:middle">About</a>`;
  const rec = satrecFor(o);
  const res = predictPasses(rec, loc, start, end, { minEl: 10, visibleOnly: vis });
  if (res.alwaysUp) { out.innerHTML = `<p>${esc(o.name)} stays above your horizon the whole time (it's probably geostationary or very high). Point at it with a dish rather than looking for passes.</p>`; return; }
  out.innerHTML = res.passes.map((p) => passCard(o.name, p, rec)).join('') || `<p class="mute">No ${vis ? 'visible ' : ''}passes above 10° in the next ${days} days. ${vis ? 'Try unticking "Visible to the eye only".' : ''}</p>`;
}

async function renderAlert() {
  const box = $('#alertBox');
  if (target === 'trains' || !server) { box.innerHTML = ''; return; }
  if (!user) { box.innerHTML = `<a class="btn small" href="/account/?next=${encodeURIComponent(location.pathname + location.search)}">Sign in to get email alerts for these passes</a>`; return; }
  box.innerHTML = '<button class="btn small" type="button" id="mkAlert">Email me before visible passes</button>';
  $('#mkAlert').onclick = async () => {
    try { await api('/api/alerts', 'POST', { kind: 'pass', norad: +target, lat: loc.lat, lon: loc.lon, height: loc.height || 0, place: loc.name || null, tz: loc.tz || Intl.DateTimeFormat().resolvedOptions().timeZone }); box.innerHTML = '<span class="chip ok">Alert saved. Manage alerts on your <a href="/account/">account page</a>.</span>'; }
    catch (e) { box.innerHTML = `<span class="chip bad">${esc(e.message)}</span>`; }
  };
}

showLoc();
if (!['25544', '48274', 'trains', '20580'].includes(target)) $$('#targets button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
else $$('#targets button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === target)));
({ server, user } = await session());
if (user) {
  try {
    const { locations } = await getJSON('/api/locations');
    $('#saved').innerHTML = locations.map((l, i) => `<button class="btn small" type="button" data-i="${i}">${esc(l.name)}</button>`).join('');
    $$('#saved button').forEach((b) => (b.onclick = () => setLoc(locations[+b.dataset.i])));
    if (!loc && locations[0]) loc = locations[0], showLoc();
  } catch {}
}
objects = (await loadCatalog()).objects;
run();
