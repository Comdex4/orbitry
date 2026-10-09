// Deep space: a top-down view of the ecliptic with planets and probes from JPL Horizons.
import { chrome, $, $$, esc, getJSON, fail, fmtDate, ago, reviewChip } from './common.js';
import { stateAt, describe, lightTime, AU_KM } from '../lib/ephemeris.js';

chrome({ footer: false });

const canvas = $('#canvas'), ctx = canvas.getContext('2d');
const PLANET_COLOR = { Mercury: '#b9b2a6', Venus: '#e8cf9a', Earth: '#5cc8ff', Mars: '#e07a4f', Jupiter: '#d9b48a', Saturn: '#e6d29a', Uranus: '#9fe0e6', Neptune: '#6f8cff' };
let data, probes = {}, bodies = [], t = Date.now(), scale = 'log', zoom = 1, pan = { x: 0, y: 0 }, selected = null;

// Map heliocentric AU to screen pixels.
function project(x, y) {
  const r = Math.hypot(x, y), w = canvas.clientWidth, h = canvas.clientHeight, R = Math.min(w, h) * 0.46 * zoom;
  const rr = scale === 'log' ? Math.log10(1 + r / 0.25) / Math.log10(1 + 180 / 0.25) : r / 35;
  const k = r > 0 ? rr / r : 0;
  return [w / 2 + pan.x + x * k * R, h / 2 + pan.y - y * k * R];
}

function draw() {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.font = '12px Inter, system-ui, sans-serif';
  // Reference rings.
  const [cx, cy] = project(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.fillStyle = 'rgba(255,255,255,.28)';
  for (const au of [1, 5, 10, 30, 100]) {
    const [px] = project(au, 0), r = px - cx;
    if (r < 8 || r > 4000) continue;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillText(`${au} AU`, cx + r + 3, cy - 3);
  }
  // Sun.
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 2 * Math.PI); ctx.fill();
  const earth = stateAt(bodies.find((b) => b.name === 'Earth')?.v, t);
  for (const b of bodies) {
    const s = stateAt(b.v, t);
    if (!s) continue;
    const [x, y] = project(s.x, s.y);
    if (b.kind === 'planet') {
      const r = Math.hypot(s.x, s.y), [ox] = project(r, 0);
      ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.arc(cx, cy, ox - cx, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = PLANET_COLOR[b.name] || '#ccc'; ctx.beginPath(); ctx.arc(x, y, b.name === 'Jupiter' || b.name === 'Saturn' ? 5 : 3.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = 'rgba(233,237,246,.75)'; ctx.fillText(b.name, x + 7, y + 4);
    } else {
      // Trail over the sampled window.
      ctx.strokeStyle = b.slug === selected ? 'rgba(92,200,255,.8)' : 'rgba(255,180,84,.35)'; ctx.beginPath();
      b.v.forEach((row, i) => { const [px, py] = project(row[1], row[2]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      ctx.fillStyle = b.slug === selected ? '#5cc8ff' : '#ffb454';
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = b.slug === selected ? '#fff' : 'rgba(255,214,160,.9)'; ctx.fillText(b.name, x + 7, y + 4);
    }
    b.screen = [x, y];
  }
  $('#clock').textContent = new Date(t).toISOString().slice(0, 10);
  table(earth);
}

function table(earth) {
  const rows = bodies.filter((b) => b.kind === 'probe').map((b) => ({ b, s: stateAt(b.v, t) })).filter((x) => x.s)
    .map(({ b, s }) => ({ b, d: describe(s, earth) })).sort((a, b) => b.d.earthAU - a.d.earthAU);
  $('#tbl tbody').innerHTML = rows.map(({ b, d }) => `<tr data-slug="${b.slug}" aria-selected="${b.slug === selected}"><td>${esc(b.name)}</td>
    <td class="r num">${d.earthAU >= 0.1 ? d.earthAU.toFixed(d.earthAU > 20 ? 1 : 2) + ' AU' : (d.earthKm / 1e6).toFixed(2) + 'M km'}</td>
    <td class="r num">${lightTime(d.lightSec, true)}</td><td class="r num">${d.speedKms.toFixed(1)} km/s</td></tr>`).join('');
  $$('#tbl tr[data-slug]').forEach((tr) => (tr.onclick = () => choose(tr.dataset.slug)));
  if (selected) detail(rows.find((r) => r.b.slug === selected));
}

function detail(row) {
  const el = $('#detail');
  if (!row) { el.hidden = true; return; }
  const p = probes[row.b.slug] || {}, d = row.d;
  el.hidden = false;
  el.innerHTML = `<h3 style="font-size:1.05rem">${esc(row.b.name)} ${reviewChip(p)}</h3>
    <dl class="facts" style="margin-top:8px">
      <dt>Operator</dt><dd>${esc(p.operator || '—')}</dd><dt>Launched</dt><dd>${fmtDate(p.launch_date)}</dd>
      <dt>From the Sun</dt><dd>${d.sunAU.toFixed(3)} AU</dd>
      <dt>From Earth</dt><dd>${Math.round(d.earthKm).toLocaleString()} km</dd>
      <dt>One-way light time</dt><dd>${lightTime(d.lightSec)}</dd>
      <dt>Speed (Sun-relative)</dt><dd>${d.speedKms.toFixed(2)} km/s</dd></dl>
    ${(p.facts || []).length ? `<ul style="padding-left:18px;font-size:.86rem;color:#c9d1e0">${p.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${p.position_note ? `<p class="notice" style="font-size:.8rem">${esc(p.position_note)}</p>` : ''}
    <p><a class="btn small primary" href="/object/?id=probe:${esc(row.b.slug)}">Full page</a></p>`;
}

function choose(slug) { selected = selected === slug ? null : slug; draw(); }

/* interaction */
{
  let drag = null, moved = 0;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; moved = 0; canvas.classList.add('dragging'); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; pan.x += e.clientX - drag.x; pan.y += e.clientY - drag.y; moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; draw(); });
  canvas.addEventListener('pointerup', (e) => {
    drag = null; canvas.classList.remove('dragging');
    if (moved > 5) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = bodies.filter((b) => b.kind === 'probe' && b.screen).sort((a, b) => Math.hypot(a.screen[0] - x, a.screen[1] - y) - Math.hypot(b.screen[0] - x, b.screen[1] - y))[0];
    if (hit && Math.hypot(hit.screen[0] - x, hit.screen[1] - y) < 16) choose(hit.slug);
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.3, Math.min(40, zoom * (e.deltaY > 0 ? 0.9 : 1.1))); draw(); }, { passive: false });
}
$$('#scale button').forEach((b) => (b.onclick = () => { scale = b.dataset.s; $$('#scale button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); zoom = 1; pan = { x: innerWidth > 900 ? 220 : 0, y: 0 }; draw(); }));
$('#day').oninput = (e) => { t = Date.now() + +e.target.value * 864e5; draw(); };
$('#now').onclick = () => { $('#day').value = 0; t = Date.now(); draw(); };
new ResizeObserver(draw).observe($('#stage'));

try {
  const [ss, pr] = await Promise.all([getJSON('/data/solar-system.json'), getJSON('/data/probes.json')]);
  data = ss; bodies = ss.bodies;
  for (const p of pr.probes) probes[p.slug] = p;
  const start = Date.parse(ss.window.start), stop = Date.parse(ss.window.stop);
  $('#day').min = Math.ceil((start - Date.now()) / 864e5); $('#day').max = Math.floor((stop - Date.now()) / 864e5);
  if (innerWidth > 900) pan.x = 220;
  $('#gen').textContent = `updated ${ago(ss.generated)}, covering ${ss.window.start} to ${ss.window.stop}`;
  selected = new URLSearchParams(location.search).get('probe');
  $('#loading').hidden = true;
  draw();
  setInterval(() => { if (+$('#day').value === 0) { t = Date.now(); draw(); } }, 10000);
} catch (e) { fail($('#loading'), `Ephemeris data could not be loaded (${e.message}).`); }
