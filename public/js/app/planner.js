import { chrome, $, $$, esc, me, api, getJSON, geocode, savedLocation, rememberLocation } from './common.js';
import { PLANS } from './plans.js';
import { fetchWeather, planNight } from '../lib/planner.js';
import { fieldOfView } from '../lib/streaks.js';

chrome();
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let user = null, unlocked = false, loc = savedLocation(), plan = null, targetsData = null;

$('#hz').innerHTML = DIRS.map((d, i) => `<label>${d}<input type="number" min="0" max="80" value="0" data-hz="${i}" aria-label="Obstruction toward ${d}"></label>`).join('');
const today = new Date(); $('#date').value = new Date(today - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const tz = () => loc?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
const tm = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz() });
function sensor() {
  const v = $('#sensor').value;
  if (v === 'custom') return [+$('#sw').value, +$('#sh').value];
  return v.split('x').map(Number);
}
function fov() { const [w, h] = sensor(); return fieldOfView(+$('#focal').value || 50, w, h); }
function horizon() { return $$('[data-hz]').map((i) => +i.value || 0); }
function showLoc() { $('#locNow').textContent = loc ? `${loc.name || 'Location'} (${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)})` : 'No location yet'; }
function showFov() { const f = fov(); $('#fovNote').textContent = `Field of view ${f.w.toFixed(2)}° × ${f.h.toFixed(2)}°`; }
$('#sensor').onchange = () => { $('#customSensor').hidden = $('#sensor').value !== 'custom'; showFov(); };
for (const id of ['#focal', '#sw', '#sh']) $(id).addEventListener('input', showFov);

// Local wall-clock time at a place → UTC milliseconds.
function zonedToUtc(dateStr, timeStr, zone) {
  const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return guess - (asLocal - guess);
}

/* location search */
let lt;
$('#locQ').addEventListener('input', () => {
  clearTimeout(lt); const v = $('#locQ').value.trim();
  if (v.length < 2) { $('#locSugg').hidden = true; return; }
  lt = setTimeout(async () => {
    const res = await geocode(v).catch(() => []);
    $('#locSugg').innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join('');
    $('#locSugg').hidden = !res.length;
    $$('#locSugg button').forEach((b) => (b.onclick = () => { loc = res[+b.dataset.i]; rememberLocation(loc); $('#locSugg').hidden = true; $('#locQ').value = ''; showLoc(); run(); }));
  }, 250);
});

function gate() {
  const g = $('#gate');
  const cta = !user
    ? `<a class="btn primary" href="/account/?next=/planner/">Sign in</a>`
    : `<button class="btn primary" type="button" id="buy">Subscribe · ${esc(PLANS.planner.price)}</button>`;
  if (unlocked) { g.innerHTML = ''; return; }
  g.innerHTML = `<div class="notice info" style="margin-top:14px">Tonight's darkness, Moon and cloud forecast are free. Target recommendations, satellite-streak warnings and the nightly email are part of the <strong>${esc(PLANS.planner.name)}</strong> plan. <span style="margin-left:8px">${cta}</span></div>`;
  for (const id of ['#targetsWrap', '#streakWrap']) {
    const v = document.createElement('div'); v.className = 'veil';
    v.innerHTML = `<div><p style="margin:0 0 10px">${esc(PLANS.planner.blurb)}</p>${cta}</div>`;
    $(id).append(v);
  }
  $$('#buy').forEach((b) => (b.onclick = async () => { try { location.href = (await api('/api/billing/checkout', 'POST', { plan: 'planner' })).url; } catch (e) { b.textContent = e.message; } }));
  $('#emailRow').hidden = true; $('#save').hidden = true;
}

async function run() {
  showLoc();
  if (!loc) return;
  const [y, m, d] = $('#date').value.split('-').map(Number);
  $('#tonight').innerHTML = '<p class="mute">Planning…</p>';
  targetsData = targetsData || (await getJSON('/data/targets.json')).targets;
  const weather = await fetchWeather(loc.lat, loc.lon).catch(() => null);
  plan = planNight(loc, new Date(Date.UTC(y, m - 1, d, 12)), { targets: unlocked ? targetsData : [], weather, horizon: horizon(), minAlt: +$('#minAlt').value, fov: fov() });
  renderTonight(weather);
  renderTargets();
}

function renderTonight(weather) {
  const p = plan, w = p.window;
  const hourly = [];
  for (const h of p.hours) { const k = Math.floor(h.t / 3600e3); const last = hourly.at(-1); if (last && last.k === k) { last.items.push(h); } else hourly.push({ k, items: [h] }); }
  const bars = hourly.map((g) => {
    const c = g.items.filter((x) => x.cloud != null), cloud = c.length ? c.reduce((s, x) => s + x.cloud, 0) / c.length : null, moon = g.items.some((x) => x.moonAlt > 0);
    return `<div class="${moon ? 'moon' : ''}" style="height:${cloud == null ? 2 : Math.max(2, cloud)}%" title="${tm(g.k * 3600e3)}: ${cloud == null ? 'no forecast' : Math.round(cloud) + '% cloud'}${moon ? ', Moon up' : ''}"></div>`;
  }).join('');
  $('#tonight').innerHTML = `<h3>${esc(p.verdict)}</h3>
    <dl class="facts left">
      <dt>Sunset</dt><dd>${p.night.sunset ? tm(p.night.sunset) : '—'}</dd>
      <dt>${w ? (w.level === 'astronomical' ? 'Astronomical darkness' : 'Darkest (nautical twilight)') : 'Darkness'}</dt><dd>${w ? `${tm(w.start)} to ${tm(w.end)}` : 'The Sun stays too close to the horizon tonight'}</dd>
      <dt>Moon</dt><dd>${esc(p.moon.name)}, ${Math.round(p.moon.fraction * 100)}% lit, ${p.moon.upFraction > 0 ? `up for ${Math.round(p.moon.upFraction * 100)}% of the dark hours` : 'below the horizon while dark'}</dd>
      <dt>Cloud</dt><dd>${p.meanCloud == null ? 'Forecast not available for this night' : `${Math.round(p.meanCloud)}% average while dark`}</dd>
    </dl>
    ${w && weather ? `<div class="bars" aria-label="Cloud cover by hour">${bars}</div><div class="axis"><span>${tm(w.start)}</span><span>cloud cover by hour · gold base = Moon up</span><span>${tm(w.end)}</span></div>` : ''}
    <p class="dim" style="font-size:.8rem;margin:8px 0 0">Times in ${esc(tz())}.</p>`;
}

function renderTargets() {
  const el = $('#targets');
  if (!unlocked) { el.innerHTML = '<h3>Best targets tonight</h3><p class="mute">Ranked by how long each target is high in a dark, clear sky, away from the Moon.</p><div style="height:220px"></div>'; return; }
  const list = plan.targets.slice(0, 20);
  el.innerHTML = `<h3>Best targets tonight</h3>
    <div class="table-wrap"><table><thead><tr><th>Target</th><th>Type</th><th class="r">Best at</th><th class="r">Max alt</th><th class="r">Usable</th><th>Notes</th></tr></thead><tbody>
    ${list.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.type)}</td><td class="r num">${t.best ? tm(t.best) : '—'}</td><td class="r num">${t.maxAlt}°</td><td class="r num">${(t.usableMin / 60).toFixed(1)} h</td><td class="dim">${esc(t.note || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">Nothing clears your horizon in darkness tonight.</td></tr>'}
    </tbody></table></div>`;
  $('#sTarget').innerHTML = list.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('');
  if (list[0]?.best) $('#sStart').value = new Date(list[0].best).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz() });
}

function frameSvg(hits, circle) {
  const shape = circle ? '<circle cx="45" cy="30" r="29" fill="none" stroke="rgba(255,255,255,.15)"/>' : '';
  const lines = hits.map((s) => {
    const k = circle ? 29 : 1, X = (v) => 45 + v * (circle ? k : 45), Y = (v) => 30 - v * (circle ? k : 30);
    return `<line x1="${X(s.from.x)}" y1="${Y(s.from.y)}" x2="${X(s.to.x)}" y2="${Y(s.to.y)}" stroke="${s.sunlit ? '#ff5fa2' : 'rgba(147,160,184,.5)'}" stroke-width="${s.sunlit ? 1.6 : 1}" stroke-dasharray="${s.sunlit ? '' : '2 2'}"/>`;
  }).join('');
  return `<svg viewBox="0 0 90 60">${shape}${lines}</svg>`;
}

let worker;
$('#sRun').onclick = () => {
  if (!unlocked || !plan) return;
  const t = plan.targets[+$('#sTarget').value];
  if (!t) return;
  let start = zonedToUtc($('#date').value, $('#sStart').value, tz());
  if (+$('#sStart').value.slice(0, 2) < 12) start += 864e5; // morning times belong to the end of this night
  const len = +$('#sLen').value, n = +$('#sCount').value, gap = +$('#sGap').value;
  const exposures = Array.from({ length: n }, (_, i) => ({ start: start + i * (len + gap) * 1000, seconds: len }));
  const rot = $('#sRot').value === '' ? null : +$('#sRot').value;
  worker = worker || new Worker('/js/workers/streaks.js', { type: 'module' });
  $('#sProg').hidden = false; $('#sProg').value = 0; $('#sOut').innerHTML = '<p class="mute">Checking every tracked object… this takes a few seconds.</p>';
  worker.onmessage = (e) => {
    if (e.data.progress != null) { $('#sProg').value = e.data.progress; return; }
    $('#sProg').hidden = true;
    if (e.data.error) { $('#sOut').innerHTML = `<p class="notice">${esc(e.data.error)}</p>`; return; }
    const s = e.data.streaks, lit = s.filter((x) => x.sunlit);
    const byExp = exposures.map((_, i) => s.filter((x) => x.exposure === i));
    const affected = byExp.filter((l) => l.some((x) => x.sunlit)).length;
    $('#sOut').innerHTML = `<p><strong>${affected} of ${n} frames</strong> will probably have a satellite streak (${lit.length} sunlit crossing${lit.length === 1 ? '' : 's'}). ${s.length - lit.length} more cross while in Earth's shadow and should not show. Checked ${e.data.checked.toLocaleString()} objects${rot == null ? '; rotation unknown, so any crossing of the circle around your frame counts' : ''}.</p>
      <div class="frames">${byExp.map((l, i) => `<div class="frame ${l.some((x) => x.sunlit) ? 'hit' : ''}">${frameSvg(l, rot == null)}${tm(exposures[i].start)}${l.filter((x) => x.sunlit).length ? ` · ${l.filter((x) => x.sunlit).length}` : ''}</div>`).join('')}</div>
      ${lit.length ? `<h3 style="margin-top:16px">Sunlit crossings</h3><div class="table-wrap"><table><thead><tr><th>Frame</th><th>Object</th><th class="r">Enters</th><th class="r">In frame</th></tr></thead><tbody>${lit.map((x) => `<tr><td>${x.exposure + 1}</td><td><a href="/object/?norad=${x.norad}">${esc(x.name)}</a></td><td class="r num">${new Date(x.enter).toLocaleTimeString(undefined, { timeZone: tz() })}</td><td class="r num">${((x.exit - x.enter) / 1000).toFixed(1)} s</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  };
  worker.postMessage({ obs: loc, target: { ra: t.ra, dec: t.dec }, fov: fov(), rotation: rot, exposures, minEl: 0 });
};

$('#setup').onsubmit = (e) => { e.preventDefault(); run(); };
$('#save').onclick = async () => {
  if (!loc) { $('#saveMsg').textContent = 'Set a location first.'; return; }
  const [w, h] = sensor();
  try {
    await api('/api/planner', 'PUT', { location: loc, equipment: { focal_mm: +$('#focal').value, sensor_w_mm: w, sensor_h_mm: h }, min_alt: +$('#minAlt').value, horizon: horizon(), email_nightly: $('#emailNightly').checked });
    $('#saveMsg').textContent = 'Saved.' + ($('#emailNightly').checked ? ' Your plan will arrive each afternoon.' : '');
  } catch (err) { $('#saveMsg').textContent = err.message; }
};

showFov(); showLoc();
user = await me();
unlocked = !!user?.planner;
if (unlocked) {
  try {
    const { profile } = await getJSON('/api/planner', {});
    if (profile) {
      loc = profile.location; $('#focal').value = profile.equipment.focal_mm; $('#minAlt').value = profile.min_alt; $('#emailNightly').checked = profile.email_nightly;
      const key = `${profile.equipment.sensor_w_mm}x${profile.equipment.sensor_h_mm}`;
      if ([...$('#sensor').options].some((o) => o.value === key)) $('#sensor').value = key;
      else { $('#sensor').value = 'custom'; $('#customSensor').hidden = false; $('#sw').value = profile.equipment.sensor_w_mm; $('#sh').value = profile.equipment.sensor_h_mm; }
      (profile.horizon || []).forEach((v, i) => { const inp = $(`[data-hz="${i}"]`); if (inp) inp.value = v; });
      showFov();
    }
  } catch {}
}
gate();
run();
