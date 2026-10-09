// The Earth-orbit globe: a day/night Earth, every active object as a point, selection with an
// orbit trace, and a simulation clock that can run forwards, backwards or jump to a time.
import * as THREE from '../../vendor/three/three.module.min.js';
import { ORBITS, PURPOSES } from '../lib/catalog.js';
import { satrecFor, stateAt, orbitTrace, satellite } from '../lib/orbit.js';
import { sunEquatorial, gmst } from '../lib/astro.js';

const RE = 6371;
const PALETTE = ['#5cc8ff', '#ffb454', '#ff5fa2', '#6be3a4', '#b48cff', '#ffd166', '#8be9fd', '#ff7a59', '#c9d1e0', '#f78fb3'];
const OTHER = '#5b6478';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
// ECF km → scene units (Earth radius 1, y up through the north pole).
const toScene = (e, out = new THREE.Vector3()) => out.set(e.x / RE, e.z / RE, -e.y / RE);

function dotTexture(ring) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  if (ring) { x.strokeStyle = '#fff'; x.lineWidth = 6; x.beginPath(); x.arc(32, 32, 24, 0, 6.2832); x.stroke(); }
  else { const g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, '#fff'); g.addColorStop(.5, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }
  return new THREE.CanvasTexture(c);
}

// Groups for each coloring mode: { key: {label, color} }, plus a function mapping an object to a key.
export function grouping(mode, objects) {
  if (mode === 'orbit') return { groups: ORBITS, key: (o) => o.orbit };
  if (mode === 'purpose') return { groups: PURPOSES, key: (o) => o.purpose };
  const field = mode === 'country' ? 'countryName' : 'operatorName';
  const counts = new Map();
  for (const o of objects) { const k = o[field] || 'Not recorded'; counts.set(k, (counts.get(k) || 0) + 1); }
  const top = [...counts.entries()].filter(([k]) => k !== 'Not recorded').sort((a, b) => b[1] - a[1]).slice(0, PALETTE.length).map(([k]) => k);
  const groups = {};
  top.forEach((k, i) => { groups[k] = { label: k, color: PALETTE[i] }; });
  groups.__other = { label: 'All others', color: OTHER };
  const set = new Set(top);
  return { groups, key: (o) => (set.has(o[field]) ? o[field] : '__other') };
}

export class Globe {
  constructor(canvas, { onSelect, onTick, interactive = true, autoRotate = interactive } = {}) {
    this.canvas = canvas; this.onSelect = onSelect; this.onTick = onTick;
    this.objects = []; this.N = 0; this.sel = -1; this.hidden = new Set();
    this.simMs = Date.now(); this.speed = 1; this.playing = true;
    this.rotX = 0.45; this.rotY = 0.2; this.camDist = 3.6; this.camCur = 3.6; this.focus = null; this.autoRotate = !reduceMotion && autoRotate;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.PR = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.PR);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.buildEarth();
    this.buildMarkers();
    if (interactive) this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.last = performance.now(); this.sinceUpdate = 1e9;
    requestAnimationFrame((t) => this.frame(t));
  }

  buildEarth() {
    const loader = new THREE.TextureLoader();
    const tex = (f) => { const t = loader.load(f); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    this.earthUniforms = { day: { value: tex('/textures/earth-day.jpg') }, night: { value: tex('/textures/earth-night.jpg') }, sun: { value: new THREE.Vector3(1, 0, 0) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.earthUniforms,
      vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D day; uniform sampler2D night; uniform vec3 sun; varying vec2 vUv; varying vec3 vN;
        void main(){ float d=dot(normalize(vN),normalize(sun)); float k=smoothstep(-0.12,0.12,d);
          vec3 dc=texture2D(day,vUv).rgb*0.92; vec3 nc=texture2D(night,vUv).rgb*0.9+vec3(0.012,0.02,0.04);
          gl_FragColor=vec4(mix(nc,dc,k),1.0);
          #include <colorspace_fragment>
        }`
    });
    this.world.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat));
    // Faint graticule.
    const pts = [], R = 1.002, ll = (la, lo) => new THREE.Vector3(R * Math.cos(la * Math.PI / 180) * Math.cos(lo * Math.PI / 180), R * Math.sin(la * Math.PI / 180), -R * Math.cos(la * Math.PI / 180) * Math.sin(lo * Math.PI / 180));
    for (let la = -60; la <= 60; la += 30) for (let lo = 0; lo < 360; lo += 5) pts.push(ll(la, lo), ll(la, lo + 5));
    for (let lo = 0; lo < 360; lo += 30) for (let la = -85; la < 85; la += 5) pts.push(ll(la, lo), ll(la + 5, lo));
    this.world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.07 })));
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 64), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i=pow(0.64-dot(vN,vec3(0.0,0.0,1.0)),3.0); gl_FragColor=vec4(0.3,0.6,1.0,1.0)*clamp(i,0.0,1.0); }',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    })));
  }

  buildMarkers() {
    this.marker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ size: 22 * this.PR, map: dotTexture(true), color: 0xffffff, transparent: true, depthTest: false, sizeAttenuation: false }));
    this.marker.visible = false; this.marker.frustumCulled = false; this.marker.renderOrder = 5; this.world.add(this.marker);
    this.ring = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    this.ring.visible = false; this.ring.frustumCulled = false; this.world.add(this.ring);
  }

  setObjects(objects) {
    this.objects = objects; this.N = objects.length;
    this.recs = objects.map(satrecFor);
    this.positions = new Float32Array(this.N * 3); this.colors = new Float32Array(this.N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    if (this.points) this.world.remove(this.points);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 3.2 * this.PR, map: dotTexture(false), vertexColors: true, transparent: true, alphaTest: 0.1, depthWrite: false, sizeAttenuation: false }));
    this.points.frustumCulled = false; this.world.add(this.points);
    this.update();
  }

  // Color by a grouping; returns {groups, counts} for the legend.
  setColoring(mode) {
    const { groups, key } = grouping(mode, this.objects);
    this.groupKey = key; this.groups = groups; this.hidden.clear();
    const counts = {};
    for (let i = 0; i < this.N; i++) {
      const k = key(this.objects[i]), c = rgb((groups[k] || { color: OTHER }).color);
      this.colors.set(c, 3 * i); counts[k] = (counts[k] || 0) + 1;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
    this.update();
    return { groups, counts };
  }

  setHidden(key, hide) { hide ? this.hidden.add(key) : this.hidden.delete(key); this.update(); }
  setFilter(fn) { this.filter = fn; this.update(); }

  update() {
    if (!this.N) return;
    const d = new Date(this.simMs), gm = satellite.gstime(d), p = this.positions;
    for (let i = 0; i < this.N; i++) {
      const o = 3 * i, ob = this.objects[i];
      if ((this.groupKey && this.hidden.has(this.groupKey(ob))) || (this.filter && !this.filter(ob)) || !this.recs[i]) { p[o] = p[o + 1] = p[o + 2] = 0; continue; }
      const pv = satellite.propagate(this.recs[i], d);
      if (!pv || !pv.position || Number.isNaN(pv.position.x)) { p[o] = p[o + 1] = p[o + 2] = 0; continue; }
      const e = satellite.eciToEcf(pv.position, gm);
      p[o] = e.x / RE; p[o + 1] = e.z / RE; p[o + 2] = -e.y / RE;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    // Sun direction in Earth-fixed coordinates for the day/night terminator.
    const s = sunEquatorial(d), H = s.ra - gmst(d);
    this.earthUniforms.sun.value.set(Math.cos(s.dec) * Math.cos(H), Math.sin(s.dec), -Math.cos(s.dec) * Math.sin(H));
    if (this.sel >= 0) this.updateSelection(d, gm);
    this.onTick?.(d);
  }

  updateSelection(d, gm) {
    const o = 3 * this.sel, a = this.marker.geometry.attributes.position.array;
    a[0] = this.positions[o]; a[1] = this.positions[o + 1]; a[2] = this.positions[o + 2];
    this.marker.geometry.attributes.position.needsUpdate = true;
    this.marker.visible = !!(a[0] || a[1] || a[2]);
    const ob = this.objects[this.sel], rec = this.recs[this.sel];
    if (!rec) { this.ring.visible = false; return; }
    const pts = orbitTrace(rec, d, Math.min(1440 / ob.mm, 1600), 200, gm).map((e) => toScene(e));
    this.ring.geometry.setFromPoints(pts); this.ring.visible = pts.length > 2;
    this.selState = stateAt(rec, d, gm);
  }

  select(i, focus = false) {
    this.sel = i;
    if (i < 0) { this.marker.visible = false; this.ring.visible = false; this.selState = null; this.onSelect?.(null); return; }
    this.autoRotate = false;
    this.update();
    if (focus) {
      const o = 3 * i, x = this.positions[o], y = this.positions[o + 1], z = this.positions[o + 2], r = Math.hypot(x, y, z);
      if (r > 0) this.focus = { x: Math.asin(y / r), y: -Math.PI / 2 - Math.atan2(-z, x) };
      if (r > 3) this.camDist = Math.max(this.camDist, Math.min(r * 2.2, 60));
    }
    this.onSelect?.(this.objects[i], this.selState);
  }

  indexOf(norad) { return this.objects.findIndex((o) => o.norad === norad); }

  setTime(ms) { this.simMs = ms; this.update(); }
  setSpeed(s) { this.speed = s; }
  zoom(f) { this.camDist = Math.min(80, Math.max(1.4, this.camDist * f)); }

  bindPointer() {
    const c = this.canvas, ptrs = new Map();
    let moved = 0, pinch = 0;
    const pd = () => { const a = [...ptrs.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; this.focus = null; this.autoRotate = false; c.classList.add('dragging');
      if (ptrs.size === 2) pinch = pd();
    });
    c.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 1) { const k = 0.005 * Math.min(1.6, Math.max(0.3, this.camDist / 3.6)); this.rotY += dx * k; this.rotX = Math.min(1.5, Math.max(-1.5, this.rotX + dy * k)); }
      else if (ptrs.size === 2) { const d = pd(); if (pinch) this.zoom(pinch / d); pinch = d; }
    });
    const end = (e) => {
      if (!ptrs.delete(e.pointerId)) return;
      if (ptrs.size < 2) pinch = 0;
      if (!ptrs.size) { c.classList.remove('dragging'); if (moved < 6 && e.type === 'pointerup') this.pick(e.clientX, e.clientY); }
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  }

  pick(cx, cy) {
    if (!this.N) return;
    const r = this.canvas.getBoundingClientRect(), sx = cx - r.left, sy = cy - r.top;
    this.world.updateMatrixWorld(); this.camera.updateMatrixWorld();
    const cam = this.camera.position, v = new THREE.Vector3(), w = new THREE.Vector3();
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < this.N; i++) {
      const o = 3 * i; if (!this.positions[o] && !this.positions[o + 1] && !this.positions[o + 2]) continue;
      w.set(this.positions[o], this.positions[o + 1], this.positions[o + 2]).applyMatrix4(this.world.matrixWorld);
      v.copy(w).sub(cam);
      const a = v.dot(v), b = 2 * cam.dot(v), cc = cam.dot(cam) - 1, disc = b * b - 4 * a * cc;
      if (disc > 0) { const t = (-b - Math.sqrt(disc)) / (2 * a); if (t > 0 && t < 1) continue; } // behind the Earth
      v.copy(w).project(this.camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * r.width, py = (-v.y * 0.5 + 0.5) * r.height, dd = (px - sx) ** 2 + (py - sy) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    this.select(best);
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.fov = w / h < 0.9 ? 58 : 40; this.camera.updateProjectionMatrix();
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(now - this.last, 250); this.last = now;
    if (document.hidden) return;
    if (this.playing) { this.simMs += dt * this.speed; this.sinceUpdate += dt; }
    if (this.N && this.sinceUpdate > (Math.abs(this.speed) <= 1 ? 1000 : 150)) { this.sinceUpdate = 0; this.update(); }
    if (this.focus) {
      let dy = this.focus.y - this.rotY; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const dx = this.focus.x - this.rotX; this.rotY += dy * 0.09; this.rotX += dx * 0.09;
      if (Math.abs(dy) < 0.003 && Math.abs(dx) < 0.003) this.focus = null;
    } else if (this.autoRotate) this.rotY += 0.0006 * (dt / 16);
    this.camCur += (this.camDist - this.camCur) * 0.15;
    this.camera.position.set(0, 0, this.camCur);
    this.world.rotation.set(this.rotX, this.rotY, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
