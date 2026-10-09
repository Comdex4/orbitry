import { chrome, $, $$, esc, loadCatalog, getJSON, ago, km, fail, me, api } from './common.js';
import { Globe } from './globe.js';
import { ORBITS, PURPOSES, TYPES } from '../lib/catalog.js';
import { accuracyNote, ageDays } from '../lib/orbit.js';
import { earthOverview } from '../lib/overview.js';

chrome({ footer: false });

const params = new URLSearchParams(location.search);
const globe = new Globe($('#canvas'), { onSelect: showInfo, onTick: tick });
let objects = [], user = null, favs = new Set();

function tick(d) {
  $('#clock').textContent = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  if (globe.sel >= 0 && !$('#info').hidden) refreshInfo();
}

/* ---------- details panel ---------- */
function showInfo(o) {
  const info = $('#info');
  if (!o) { info.hidden = true; history.replaceState(null, '', location.pathname); return; }
  $('#iName').textContent = o.name;
  $('#iSub').textContent = `NORAD ${o.norad}${o.intl ? ' · ' + o.intl : ''}${o.type ? ' · ' + (TYPES[o.type] || o.type) : ''}`;
  $('#iOver').textContent = earthOverview(o);
  $('#iPage').href = `/object/?norad=${o.norad}`;
  $('#iPass').href = `/passes/?norad=${o.norad}`;
  const fb = $('#iFav');
  fb.hidden = !user; fb.textContent = favs.has(o.norad) ? '★ Favorite' : '☆ Favorite';
  info.hidden = false;
  refreshInfo();
  const p = new URLSearchParams(location.search); p.set('norad', o.norad); history.replaceState(null, '', '?' + p);
}

function refreshInfo() {
  const o = globe.objects[globe.sel], s = globe.selState, rows = [];
  if (s) rows.push(['Altitude', km(s.alt)], ['Speed', `${s.speed.toFixed(2)} km/s`], ['Position', `${Math.abs(s.lat).toFixed(2)}° ${s.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.lon).toFixed(2)}° ${s.lon >= 0 ? 'E' : 'W'}`]);
  else rows.push(['Position', 'Cannot be computed from these elements']);
  rows.push(['Orbit', ORBITS[o.orbit].label], ['Period', 1440 / o.mm < 1440 ? `${(1440 / o.mm).toFixed(1)} min` : `${(24 / o.mm).toFixed(1)} h`], ['Inclination', `${o.inc.toFixed(1)}°`]);
  if (o.operatorName) rows.push(['Operator', o.operatorName]);
  if (o.countryName) rows.push(['Country', o.countryName]);
  rows.push(['Purpose', PURPOSES[o.purpose].label]);
  const age = ageDays(o, globe.simMs);
  rows.push(['Data age', `${Math.max(0, age).toFixed(1)} days`, age > 7]);
  $('#iDl').innerHTML = rows.map(([k, v, w]) => `<dt>${esc(k)}</dt><dd${w ? ' class="warn"' : ''}>${esc(v)}</dd>`).join('');
  const acc = accuracyNote(o, globe.simMs);
  $('#iAcc').textContent = acc.text;
}

$('#infoX').onclick = () => globe.select(-1);
$('#iFav').onclick = async () => {
  const o = globe.objects[globe.sel], on = favs.has(o.norad);
  try {
    await api(`/api/favorites/${o.norad}`, on ? 'DELETE' : 'PUT');
    on ? favs.delete(o.norad) : favs.add(o.norad);
    $('#iFav').textContent = favs.has(o.norad) ? '★ Favorite' : '☆ Favorite';
  } catch { $('#iFav').textContent = 'Could not save'; }
};

/* ---------- legend & coloring ---------- */
function setColoring(mode) {
  const { groups, counts } = globe.setColoring(mode);
  $$('#colorBy button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('#legend').innerHTML = '';
  for (const [k, g] of Object.entries(groups)) {
    if (!counts[k]) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<i class="dot" style="background:${g.color}"></i>${esc(g.label)}<span class="n">${counts[k].toLocaleString()}</span>`;
    b.onclick = () => { const hide = b.getAttribute('aria-pressed') === 'true'; b.setAttribute('aria-pressed', String(!hide)); globe.setHidden(k, hide); };
    $('#legend').append(b);
  }
  const p = new URLSearchParams(location.search); p.set('color', mode); history.replaceState(null, '', '?' + p);
}
$$('#colorBy button').forEach((b) => (b.onclick = () => setColoring(b.dataset.mode)));

$$('#typeFilter button').forEach((b) => (b.onclick = () => {
  $$('#typeFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const t = b.dataset.t;
  globe.setFilter(t === 'all' ? null : t === 'PAY' ? (o) => o.type === 'PAY' : (o) => o.type !== 'PAY');
}));

function collapse(on) { $('#side').classList.toggle('collapsed', on); $('#collapse').textContent = on ? 'Show filters' : 'Hide filters'; }
$('#collapse').onclick = () => collapse(!$('#side').classList.contains('collapsed'));
if (innerWidth < 760) collapse(true);

/* ---------- time ---------- */
$$('#speeds button').forEach((b) => (b.onclick = () => {
  const s = +b.dataset.s;
  $$('#speeds button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  globe.playing = s !== 0; if (s) globe.setSpeed(s);
}));
$('#jump').oninput = (e) => globe.setTime(Date.now() + +e.target.value * 3600e3);
$('#now').onclick = () => { $('#jump').value = 0; globe.setTime(Date.now()); $$('#speeds button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.s === '1'))); globe.playing = true; globe.setSpeed(1); };
$('#zin').onclick = () => globe.zoom(0.8);
$('#zout').onclick = () => globe.zoom(1.25);

/* ---------- search ---------- */
const q = $('#q'), sugg = $('#sugg');
q.addEventListener('input', () => {
  const v = q.value.trim().toLowerCase(); sugg.innerHTML = '';
  if (v.length < 2) { sugg.hidden = true; return; }
  const out = [];
  for (let i = 0; i < objects.length && out.length < 10; i++) {
    const o = objects[i];
    if (String(o.norad) === v || o.name.toLowerCase().includes(v) || (o.intl || '').toLowerCase() === v) out.push(i);
  }
  for (const i of out) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.innerHTML = `${esc(objects[i].name)} <small>· ${objects[i].norad}${objects[i].operatorName ? ' · ' + esc(objects[i].operatorName) : ''}</small>`;
    b.onclick = () => { globe.select(i, true); sugg.hidden = true; q.value = ''; };
    li.append(b); sugg.append(li);
  }
  sugg.hidden = !out.length;
});
q.addEventListener('keydown', (e) => { if (e.key === 'Enter') sugg.querySelector('button')?.click(); if (e.key === 'Escape') sugg.hidden = true; });

/* ---------- go ---------- */
try {
  const [{ raw, objects: objs }, meta] = await Promise.all([loadCatalog(), getJSON('/data/meta.json').catch(() => null)]);
  objects = objs;
  globe.setObjects(objects);
  const mode = ['orbit', 'purpose', 'country', 'operator'].includes(params.get('color')) ? params.get('color') : 'orbit';
  setColoring(mode);
  if (params.get('t')) { const t = Date.parse(params.get('t')); if (t) globe.setTime(t); }
  const n = +params.get('norad');
  if (n) { const i = globe.indexOf(n); if (i >= 0) globe.select(i, true); }
  $('#loading').hidden = true;
  const fetched = raw.sources.elements.fetched;
  const epochs = objects.map((o) => ageDays(o)).sort((a, b) => a - b), median = epochs[Math.floor(epochs.length / 2)];
  $('#fresh').innerHTML = `${objects.length.toLocaleString()} objects · elements from <a href="${esc(raw.sources.elements.url)}" rel="noopener">CelesTrak</a>, fetched ${fetched ? ago(fetched) : 'recently'} · median element age ${median.toFixed(1)} days · positions are SGP4 estimates, good to a few km when fresh · <a href="/about/">accuracy</a>`;
  if (meta && meta.steps?.catalog && !meta.steps.catalog.ok) $('#fresh').innerHTML += ' · <span style="color:var(--warm)">latest refresh failed; showing older data</span>';
} catch (e) {
  fail($('#loading'), `Orbital data could not be loaded (${e.message}).`);
}

user = await me();
if (user) {
  try { favs = new Set((await getJSON('/api/favorites')).favorites.map((f) => f.norad)); } catch {}
  if (globe.sel >= 0) $('#iFav').hidden = false;
}
