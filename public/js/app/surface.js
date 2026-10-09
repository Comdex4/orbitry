// Moon and Mars: landers, rovers and impact sites at their surface coordinates, plus orbiters.
import * as THREE from '../../vendor/three/three.module.min.js';
import { chrome, $, $$, esc, getJSON, fmtDate, fail, reviewChip } from './common.js';

chrome({ footer: false });

const body = document.body.dataset.body; // "moon" | "mars"
export const KINDS = {
  crewed: { label: 'Crewed landing', color: '#ffb454' },
  rover: { label: 'Rover', color: '#5cc8ff' },
  lander: { label: 'Lander', color: '#6be3a4' },
  'sample-return': { label: 'Sample return', color: '#b48cff' },
  impact: { label: 'Impact', color: '#ff5fa2' }
};
const OUTCOME = { success: ['ok', 'Success'], partial: ['warn', 'Partial success'], failure: ['bad', 'Failed'] };

const canvas = $('#canvas'), stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
const PR = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(PR); renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50), world = new THREE.Group();
scene.add(world);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sunLight = new THREE.DirectionalLight(0xffffff, 2.2); sunLight.position.set(-3, 1.2, 4); scene.add(sunLight);
const tex = new THREE.TextureLoader().load(`/textures/${body}.jpg`); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
world.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })));

const ll = (lat, lon, R = 1) => { const p = lat * Math.PI / 180, l = lon * Math.PI / 180; return new THREE.Vector3(R * Math.cos(p) * Math.cos(l), R * Math.sin(p), -R * Math.cos(p) * Math.sin(l)); };

// Graticule every 30°.
{
  const pts = [], R = 1.002;
  for (let la = -60; la <= 60; la += 30) for (let lo = 0; lo < 360; lo += 5) pts.push(ll(la, lo, R), ll(la, lo + 5, R));
  for (let lo = 0; lo < 360; lo += 30) for (let la = -85; la < 85; la += 5) pts.push(ll(la, lo, R), ll(la + 5, lo, R));
  world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 })));
}

function disc(ring) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.beginPath(); x.arc(32, 32, ring ? 24 : 20, 0, 6.2832);
  if (ring) { x.strokeStyle = '#fff'; x.lineWidth = 6; x.stroke(); } else { x.fillStyle = '#fff'; x.fill(); x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.6)'; x.stroke(); }
  return new THREE.CanvasTexture(c);
}

let sites = [], points, hidden = new Set(), sel = -1;
const marker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
  new THREE.PointsMaterial({ size: 26 * PR, map: disc(true), transparent: true, depthTest: false, sizeAttenuation: false }));
marker.visible = false; marker.renderOrder = 5; world.add(marker);

let rotX = 0.15, rotY = -Math.PI / 2, camDist = 3.4, camCur = 3.4, focus = null, auto = !matchMedia('(prefers-reduced-motion: reduce)').matches;

function build() {
  const pos = new Float32Array(sites.length * 3), col = new Float32Array(sites.length * 3);
  sites.forEach((s, i) => {
    const v = hidden.has(s.kind) ? new THREE.Vector3() : ll(s.lat, s.lon, 1.006);
    pos.set([v.x, v.y, v.z], 3 * i);
    const c = new THREE.Color(KINDS[s.kind].color); col.set([c.r, c.g, c.b], 3 * i);
  });
  if (points) world.remove(points);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  points = new THREE.Points(g, new THREE.PointsMaterial({ size: 11 * PR, map: disc(false), vertexColors: true, transparent: true, alphaTest: 0.2, sizeAttenuation: false }));
  world.add(points);
}

function select(i, doFocus) {
  sel = i;
  const info = $('#info');
  if (i < 0) { info.hidden = true; marker.visible = false; return; }
  const s = sites[i], v = ll(s.lat, s.lon, 1.006);
  marker.geometry.attributes.position.array.set([v.x, v.y, v.z]); marker.geometry.attributes.position.needsUpdate = true; marker.visible = true;
  auto = false;
  if (doFocus) focus = { x: s.lat * Math.PI / 180, y: -Math.PI / 2 - s.lon * Math.PI / 180 };
  const [cls, label] = OUTCOME[s.outcome] || ['', s.outcome];
  $('#iName').textContent = s.name;
  $('#iSub').innerHTML = `${esc(KINDS[s.kind].label)} · <span class="chip ${cls}">${esc(label)}</span> ${reviewChip(s)}`;
  const rows = [['Mission', s.mission], ['Operator', s.operator], ['Country', s.country], ['Launched', fmtDate(s.launch_date)],
    [s.kind === 'impact' ? 'Impact' : 'Landed', fmtDate(s.arrival_date)],
    ['Coordinates', `${Math.abs(s.lat).toFixed(3)}° ${s.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.lon).toFixed(3)}° ${s.lon >= 0 ? 'E' : 'W'}`]];
  $('#iDl').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('');
  $('#iFacts').innerHTML = s.facts.map((f) => `<li>${esc(f)}</li>`).join('');
  $('#iPage').href = `/object/?id=${body}:${s.slug}`;
  info.hidden = false;
  $$('#list button').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.i === i)));
}

function renderList() {
  const shown = sites.map((s, i) => [s, i]).filter(([s]) => !hidden.has(s.kind));
  $('#list').innerHTML = shown.map(([s, i]) => {
    const [cls, label] = OUTCOME[s.outcome] || ['', ''];
    return `<li><button type="button" data-i="${i}"><i class="dot" style="background:${KINDS[s.kind].color}"></i><span>${esc(s.name)}<br><small>${s.arrival_date.slice(0, 4)} · ${esc(s.country)}</small></span><span class="chip ${cls}" style="margin-left:auto">${esc(label)}</span></button></li>`;
  }).join('');
  $$('#list button').forEach((b) => (b.onclick = () => select(+b.dataset.i, true)));
}

function renderLegend() {
  const counts = {};
  for (const s of sites) counts[s.kind] = (counts[s.kind] || 0) + 1;
  $('#legend').innerHTML = '';
  for (const [k, v] of Object.entries(KINDS)) {
    if (!counts[k]) continue;
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(!hidden.has(k)));
    b.innerHTML = `<i class="dot" style="background:${v.color}"></i>${v.label}<span class="n">${counts[k]}</span>`;
    b.onclick = () => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); renderLegend(); renderList(); build(); };
    $('#legend').append(b);
  }
}

function renderOrbiters(list) {
  $('#orbiters').innerHTML = list.map((o) => `<li><a href="/object/?id=${body}:${esc(o.slug)}">${esc(o.name)}</a> <small class="dim">${esc(o.operator)} · arrived ${o.arrival_date.slice(0, 4)}</small></li>`).join('');
}

/* pointer */
{
  const ptrs = new Map(); let moved = 0, pinch = 0;
  const pd = () => { const a = [...ptrs.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; focus = null; auto = false; canvas.classList.add('dragging'); if (ptrs.size === 2) pinch = pd(); });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 1) { const k = 0.005 * Math.min(1.4, camDist / 3.4); rotY += dx * k; rotX = Math.max(-1.5, Math.min(1.5, rotX + dy * k)); }
    else if (ptrs.size === 2) { const d = pd(); if (pinch) camDist = Math.max(1.25, Math.min(8, camDist * pinch / d)); pinch = d; }
  });
  const end = (e) => { if (!ptrs.delete(e.pointerId)) return; if (ptrs.size < 2) pinch = 0; if (!ptrs.size) { canvas.classList.remove('dragging'); if (moved < 6 && e.type === 'pointerup') pick(e.clientX, e.clientY); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); camDist = Math.max(1.25, Math.min(8, camDist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
}

function pick(cx, cy) {
  const r = canvas.getBoundingClientRect(), v = new THREE.Vector3(), n = new THREE.Vector3();
  world.updateMatrixWorld();
  let best = -1, bd = 16 * 16;
  sites.forEach((s, i) => {
    if (hidden.has(s.kind)) return;
    v.copy(ll(s.lat, s.lon, 1.006)).applyMatrix4(world.matrixWorld);
    n.copy(v).normalize();
    if (n.dot(new THREE.Vector3().copy(camera.position).sub(v).normalize()) < 0) return; // far side
    v.project(camera);
    const d = ((v.x * .5 + .5) * r.width - (cx - r.left)) ** 2 + ((-v.y * .5 + .5) * r.height - (cy - r.top)) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  select(best, false);
}

function resize() {
  const r = stage.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < .9 ? 56 : 40; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage); resize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(now - last, 100); last = now;
  if (focus) {
    let dy = focus.y - rotY; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    const dx = focus.x - rotX; rotY += dy * .09; rotX += dx * .09;
    if (Math.abs(dx) < .003 && Math.abs(dy) < .003) focus = null;
  } else if (auto) rotY += 0.0008 * dt / 16;
  camCur += (camDist - camCur) * .15;
  camera.position.set(0, 0, camCur); world.rotation.set(rotX, rotY, 0);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

$('#infoX').onclick = () => select(-1);
function collapse(on) { $('#side').classList.toggle('collapsed', on); $('#collapse').textContent = on ? 'Show list' : 'Hide list'; }
$('#collapse').onclick = () => collapse(!$('#side').classList.contains('collapsed'));
if (innerWidth < 760) collapse(true);
$('#zin').onclick = () => (camDist = Math.max(1.25, camDist * .8));
$('#zout').onclick = () => (camDist = Math.min(8, camDist * 1.25));

try {
  const data = await getJSON(`/data/${body}.json`);
  sites = data.sites.slice().sort((a, b) => (a.arrival_date < b.arrival_date ? -1 : 1));
  build(); renderLegend(); renderList(); renderOrbiters(data.orbiters);
  $('#loading').hidden = true;
  const want = new URLSearchParams(location.search).get('site');
  if (want) { const i = sites.findIndex((s) => s.slug === want); if (i >= 0) select(i, true); }
} catch (e) { fail($('#loading'), `Surface data could not be loaded (${e.message}).`); }
