// The Earth-orbit globe: a lit Earth with real day/night, every active object drawn as a small
// icon with a motion trail, smooth 60 fps motion, and a simulation clock that can run forwards,
// backwards or jump to a time.
//
// Motion: SGP4 is exact but too slow to run for 16,000 objects every frame. So each object's
// position and velocity are refreshed from SGP4 a slice at a time (every object about every
// 0.7 s), and in between they are moved by a simple gravity model. Positions are kept in the
// inertial frame, and the whole swarm is rotated by Greenwich sidereal time to line up with the
// Earth, which is how the real geometry works.
import * as THREE from '../../vendor/three/three.module.min.js';
import { ORBITS, PURPOSES } from '../lib/catalog.js';
import { satrecFor, stateAt, propagateEci, satellite } from '../lib/orbit.js';
import { sunEquatorial, gmst } from '../lib/astro.js';

const RE = 6371, MU = 398600.4418;
const PALETTE = ['#5cc8ff', '#ffb454', '#ff5fa2', '#6be3a4', '#b48cff', '#ffd166', '#8be9fd', '#ff7a59', '#c9d1e0', '#f78fb3'];
const OTHER = '#5b6478';
const RESYNC_FRAMES = 40;      // every object gets a fresh SGP4 state within this many frames
const TRAIL_SECONDS = 40;      // trail length, in simulated seconds of travel
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

// Icon atlas (2×2): 0 satellite, 1 space station, 2 rocket body, 3 debris. Drawn white, tinted per object.
const SHAPE = { PAY: 0, STATION: 1, 'R/B': 2, DEB: 3 };
function iconAtlas() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S * 2;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
  const cell = (i, draw) => { x.save(); x.translate((i % 2) * S + S / 2, Math.floor(i / 2) * S + S / 2); draw(); x.restore(); };
  const panel = (px, py, w, h) => { x.globalAlpha = 0.9; x.fillRect(px, py, w, h); x.globalAlpha = 1; x.clearRect(px + w / 2 - 1.5, py, 3, h); };
  cell(0, () => { // satellite: body with two solar panels
    x.rotate(-Math.PI / 4);
    panel(-58, -13, 38, 26); panel(20, -13, 38, 26);
    x.fillRect(-20, -2.5, 40, 5);
    x.beginPath(); x.roundRect(-14, -16, 28, 32, 5); x.fill();
  });
  cell(1, () => { // station: truss with four panels and modules
    x.fillRect(-60, -4, 120, 8);
    for (const sx of [-52, -30, 18, 40]) { panel(sx, -40, 12, 30); panel(sx, 10, 12, 30); }
    x.beginPath(); x.roundRect(-11, -24, 22, 48, 6); x.fill();
  });
  cell(2, () => { // rocket body: a spent stage
    x.rotate(-Math.PI / 4);
    x.beginPath(); x.roundRect(-14, -44, 28, 76, 12); x.fill();
    x.beginPath(); x.moveTo(-16, 30); x.lineTo(16, 30); x.lineTo(10, 46); x.lineTo(-10, 46); x.closePath(); x.fill();
  });
  cell(3, () => { // debris: an irregular shard
    x.beginPath(); x.moveTo(-30, -18); x.lineTo(8, -34); x.lineTo(32, 6); x.lineTo(4, 30); x.lineTo(-22, 20); x.closePath(); x.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.arc(32, 32, 25, 0, 6.2832); x.stroke();
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

const EARTH_VERT = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){ vUv = uv; vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Lighting in the Earth's own frame: sun and camera are passed in object space.
const EARTH_FRAG = `
  uniform sampler2D day; uniform sampler2D night; uniform sampler2D water; uniform sampler2D topo;
  uniform vec3 sun; uniform vec3 cam; uniform float texel;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){
    vec3 n = normalize(vN), L = normalize(sun), V = normalize(cam - vP);
    // Relief: tilt the normal along the terrain slope.
    float hx = texture2D(topo, vUv + vec2(texel, 0.0)).r - texture2D(topo, vUv - vec2(texel, 0.0)).r;
    float hy = texture2D(topo, vUv + vec2(0.0, texel)).r - texture2D(topo, vUv - vec2(0.0, texel)).r;
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + 1e-5), north = cross(n, east);
    vec3 nb = normalize(n - 1.6 * (hx * east + hy * north));
    float geo = dot(n, L);
    float dayMix = smoothstep(-0.10, 0.18, geo);
    float diffuse = clamp(dot(nb, L), 0.0, 1.0);
    vec3 dayCol = texture2D(day, vUv).rgb * (0.18 + 0.95 * diffuse);
    // Sunlight glinting off the oceans.
    float sea = texture2D(water, vUv).r;
    vec3 H = normalize(L + V);
    dayCol += sea * vec3(1.0, 0.93, 0.8) * pow(max(dot(n, H), 0.0), 60.0) * 0.55 * step(0.0, geo);
    // Warm band along the terminator.
    dayCol = mix(dayCol, dayCol * vec3(1.25, 0.82, 0.62), (1.0 - smoothstep(0.0, 0.22, abs(geo))) * 0.55 * dayMix);
    vec3 nightCol = texture2D(night, vUv).rgb * 1.35 + vec3(0.004, 0.008, 0.02);
    vec3 col = mix(nightCol, dayCol, dayMix);
    // Atmospheric rim, brighter on the day side.
    float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += vec3(0.30, 0.58, 1.0) * rim * (0.15 + 0.85 * smoothstep(-0.2, 0.5, geo)) * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
const ATMO_FRAG = `
  uniform vec3 sun; uniform vec3 cam; varying vec3 vN; varying vec3 vP;
  void main(){
    vec3 n = normalize(vN), V = normalize(cam - vP);
    float edge = pow(clamp(1.0 + dot(n, V), 0.0, 1.0), 4.0);      // back faces: glow toward the limb
    float lit = 0.25 + 0.75 * smoothstep(-0.35, 0.45, dot(n, normalize(sun)));
    gl_FragColor = vec4(vec3(0.28, 0.58, 1.0) * edge * lit * 1.4, 1.0);
  }`;
const SAT_VERT = `
  attribute vec3 color; attribute float shape; attribute float scale;
  uniform float size; varying vec3 vColor; varying float vShape;
  void main(){
    vColor = color; vShape = shape;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale;
    gl_Position = projectionMatrix * mv;
  }`;
const SAT_FRAG = `
  uniform sampler2D atlas; varying vec3 vColor; varying float vShape;
  void main(){
    vec2 cell = vec2(mod(vShape, 2.0), 1.0 - floor(vShape / 2.0));
    vec2 uv = (vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) + cell) * 0.5;
    float a = texture2D(atlas, uv).a;
    if (a < 0.12) discard;
    gl_FragColor = vec4(vColor * (0.75 + 0.35 * a), a);
    #include <colorspace_fragment>
  }`;

export class Globe {
  constructor(canvas, { onSelect, onTick, interactive = true, autoRotate = interactive, trails = true, labels = interactive, maxPixelRatio = 2 } = {}) {
    this.canvas = canvas; this.onSelect = onSelect; this.onTick = onTick; this.trails = trails;
    this.objects = []; this.N = 0; this.sel = -1; this.hidden = new Set();
    this.simMs = Date.now(); this.speed = 1; this.playing = true;
    this.rotX = 0.45; this.rotY = 0.2; this.camDist = 3.6; this.camCur = 3.6; this.focus = null; this.autoRotate = !reduceMotion && autoRotate;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.PR = Math.min(devicePixelRatio || 1, maxPixelRatio);
    this.renderer.setPixelRatio(this.PR);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.inertial = new THREE.Group(); this.world.add(this.inertial); // rotated by -GMST every frame
    this.buildEarth();
    this.buildStars();
    this.buildMarkers();
    if (labels) this.buildLabel();
    if (interactive) this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.last = performance.now(); this.frameNo = 0; this.lastTick = 0; this.lastRing = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  buildEarth() {
    const loader = new THREE.TextureLoader();
    const tex = (f, srgb = true) => { const t = loader.load(f); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    this.earthUniforms = {
      day: { value: tex('/textures/earth-day.jpg') }, night: { value: tex('/textures/earth-night.jpg') },
      water: { value: tex('/textures/earth-water.jpg', false) }, topo: { value: tex('/textures/earth-topology.jpg', false) },
      sun: { value: new THREE.Vector3(1, 0, 0) }, cam: { value: new THREE.Vector3(0, 0, 4) }, texel: { value: 1 / 2048 }
    };
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.ShaderMaterial({ uniforms: this.earthUniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }));
    this.world.add(this.earth);
    this.atmoUniforms = { sun: this.earthUniforms.sun, cam: this.earthUniforms.cam };
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 64), new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms, vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    }));
    this.world.add(this.atmo);
    // Faint graticule.
    const pts = [], R = 1.0015, ll = (la, lo) => new THREE.Vector3(R * Math.cos(la * Math.PI / 180) * Math.cos(lo * Math.PI / 180), R * Math.sin(la * Math.PI / 180), -R * Math.cos(la * Math.PI / 180) * Math.sin(lo * Math.PI / 180));
    for (let la = -60; la <= 60; la += 30) for (let lo = 0; lo < 360; lo += 5) pts.push(ll(la, lo), ll(la, lo + 5));
    for (let lo = 0; lo < 360; lo += 30) for (let la = -85; la < 85; la += 5) pts.push(ll(la, lo), ll(la + 5, lo));
    this.world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.05 })));
  }

  buildStars() {
    // A fixed, deterministic starfield far behind everything.
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 180, s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], 3 * i);
      const b = 0.35 + rnd() ** 3 * 0.65, warm = rnd();
      col.set([b * (warm > 0.8 ? 1 : 0.85), b * 0.9, b * (warm < 0.2 ? 1 : 0.95)], 3 * i);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3 * this.PR, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    stars.renderOrder = -1;
    this.world.add(stars);
  }

  buildMarkers() {
    this.marker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ size: 26 * this.PR, map: ringTexture(), color: 0xffffff, transparent: true, depthTest: false, sizeAttenuation: false }));
    this.marker.visible = false; this.marker.frustumCulled = false; this.marker.renderOrder = 5; this.inertial.add(this.marker);
    this.ring = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.ring.visible = false; this.ring.frustumCulled = false; this.inertial.add(this.ring);
  }

  buildLabel() {
    const parent = this.canvas.parentElement;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    this.label = document.createElement('div');
    this.label.setAttribute('aria-hidden', 'true');
    Object.assign(this.label.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '3', font: '600 12px/1.2 Inter, system-ui, sans-serif', color: '#fff',
      background: 'rgba(5,7,13,.72)', border: '1px solid rgba(255,255,255,.18)', borderRadius: '999px', padding: '3px 9px', whiteSpace: 'nowrap', transform: 'translate(14px,-50%)', display: 'none' });
    parent.append(this.label);
  }

  setObjects(objects) {
    this.objects = objects; const N = this.N = objects.length;
    this.recs = objects.map(satrecFor);
    this.r = new Float64Array(N * 3); this.v = new Float64Array(N * 3); this.ok = new Uint8Array(N); this.show = new Uint8Array(N).fill(1);
    this.positions = new Float32Array(N * 3); this.colors = new Float32Array(N * 3);
    const shapes = new Float32Array(N), scales = new Float32Array(N);
    objects.forEach((o, i) => {
      const station = o.purpose === 'human' && o.type === 'PAY';
      shapes[i] = station ? SHAPE.STATION : SHAPE[o.type] ?? SHAPE.PAY;
      scales[i] = station ? 2.1 : o.type === 'DEB' ? 0.75 : o.type === 'R/B' ? 0.9 : 1;
    });
    if (this.points) { this.inertial.remove(this.points); this.inertial.remove(this.trailLines); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    g.setAttribute('shape', new THREE.BufferAttribute(shapes, 1));
    g.setAttribute('scale', new THREE.BufferAttribute(scales, 1));
    this.satUniforms = { atlas: { value: iconAtlas() }, size: { value: 7 * this.PR } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.satUniforms, vertexShader: SAT_VERT, fragmentShader: SAT_FRAG, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false; this.points.renderOrder = 2; this.inertial.add(this.points);
    // Trails: one segment per object, bright at the object and fading behind it.
    this.trailPos = new Float32Array(N * 6); this.trailCol = new Float32Array(N * 6);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trailLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trailLines.frustumCulled = false; this.trailLines.visible = this.trails; this.trailLines.renderOrder = 1; this.inertial.add(this.trailLines);
    this.resyncAll();
  }

  // Fresh SGP4 state for object i at the current simulated time (km, km/s, inertial TEME).
  resync(i, d) {
    const o = 3 * i, pv = this.recs[i] && propagateEci(this.recs[i], d);
    if (!pv || !pv.velocity) { this.ok[i] = 0; return; }
    const p = pv.position, v = pv.velocity;
    this.r[o] = p.x; this.r[o + 1] = p.y; this.r[o + 2] = p.z; this.v[o] = v.x; this.v[o + 1] = v.y; this.v[o + 2] = v.z; this.ok[i] = 1;
  }

  resyncAll() {
    if (!this.N) return;
    const d = new Date(this.simMs);
    for (let i = 0; i < this.N; i++) this.resync(i, d);
    this.writeBuffers();
    this.updateSelection(true);
  }

  // Gravity between SGP4 refreshes: two-body plus the Earth's equatorial bulge (J2), stepped with
  // velocity Verlet in 10 s sub-steps. Drift stays under a kilometre even at 3,600× playback.
  integrate(dt) {
    const steps = Math.max(1, Math.ceil(Math.abs(dt) / 10)), h = dt / steps, r = this.r, v = this.v;
    const J = -1.5 * 1.08263e-3 * MU * 6378.137 ** 2, a = [0, 0, 0];
    const acc = (x, y, z) => {
      const d2 = x * x + y * y + z * z, d = Math.sqrt(d2), k = -MU / (d2 * d), z2 = z * z / d2, j = J / (d2 * d2 * d);
      a[0] = k * x + j * x * (1 - 5 * z2); a[1] = k * y + j * y * (1 - 5 * z2); a[2] = k * z + j * z * (3 - 5 * z2);
    };
    for (let s = 0; s < steps; s++) {
      for (let i = 0, o = 0; i < this.N; i++, o += 3) {
        if (!this.ok[i]) continue;
        acc(r[o], r[o + 1], r[o + 2]);
        v[o] += 0.5 * a[0] * h; v[o + 1] += 0.5 * a[1] * h; v[o + 2] += 0.5 * a[2] * h;
        r[o] += v[o] * h; r[o + 1] += v[o + 1] * h; r[o + 2] += v[o + 2] * h;
        acc(r[o], r[o + 1], r[o + 2]);
        v[o] += 0.5 * a[0] * h; v[o + 1] += 0.5 * a[1] * h; v[o + 2] += 0.5 * a[2] * h;
      }
    }
  }

  // Inertial km → scene units (y up through the north pole), plus trails.
  writeBuffers() {
    const P = this.positions, T = this.trailPos, TC = this.trailCol, C = this.colors, r = this.r, v = this.v, k = TRAIL_SECONDS;
    for (let i = 0, o = 0, t = 0; i < this.N; i++, o += 3, t += 6) {
      if (!this.ok[i] || !this.show[i]) { P[o] = P[o + 1] = P[o + 2] = 0; T.fill(0, t, t + 6); continue; }
      const x = r[o] / RE, y = r[o + 2] / RE, z = -r[o + 1] / RE;
      P[o] = x; P[o + 1] = y; P[o + 2] = z;
      if (this.trails) {
        T[t] = x; T[t + 1] = y; T[t + 2] = z;
        T[t + 3] = x - v[o] * k / RE; T[t + 4] = y - v[o + 2] * k / RE; T[t + 5] = z + v[o + 1] * k / RE;
        TC[t] = C[o]; TC[t + 1] = C[o + 1]; TC[t + 2] = C[o + 2]; TC[t + 3] = TC[t + 4] = TC[t + 5] = 0;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    if (this.trails) { this.trailLines.geometry.attributes.position.needsUpdate = true; this.trailLines.geometry.attributes.color.needsUpdate = true; }
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
    this.applyVisibility();
    return { groups, counts };
  }

  applyVisibility() {
    for (let i = 0; i < this.N; i++) {
      const ob = this.objects[i];
      this.show[i] = (this.groupKey && this.hidden.has(this.groupKey(ob))) || (this.filter && !this.filter(ob)) ? 0 : 1;
    }
    this.writeBuffers();
  }
  setHidden(key, hide) { hide ? this.hidden.add(key) : this.hidden.delete(key); this.applyVisibility(); }
  setFilter(fn) { this.filter = fn; this.applyVisibility(); }

  // Selection: marker, inertial orbit ellipse, and the state shown in the details panel.
  updateSelection(force = false) {
    if (this.sel < 0) return;
    const o = 3 * this.sel, a = this.marker.geometry.attributes.position.array;
    a[0] = this.positions[o]; a[1] = this.positions[o + 1]; a[2] = this.positions[o + 2];
    this.marker.geometry.attributes.position.needsUpdate = true;
    this.marker.visible = !!(a[0] || a[1] || a[2]);
    const now = performance.now(), rec = this.recs[this.sel];
    if (!rec) { this.ring.visible = false; return; }
    if (force || now - this.lastRing > 2000) {
      this.lastRing = now;
      const d = new Date(this.simMs), T = 1440 / this.objects[this.sel].mm * 60000, pts = [];
      for (let k = 0; k <= 240; k++) {
        const pv = propagateEci(rec, new Date(+d + (k / 240) * Math.min(T, 1600 * 60000)));
        if (pv) pts.push(new THREE.Vector3(pv.position.x / RE, pv.position.z / RE, -pv.position.y / RE));
      }
      this.ring.geometry.setFromPoints(pts); this.ring.visible = pts.length > 2;
    }
    if (force || now - (this.lastState || 0) > 400) { this.lastState = now; this.selState = stateAt(rec, new Date(this.simMs)); }
  }

  select(i, focus = false) {
    this.sel = i;
    if (i < 0) { this.marker.visible = false; this.ring.visible = false; this.selState = null; if (this.label) this.label.style.display = 'none'; this.onSelect?.(null); return; }
    this.autoRotate = false;
    this.resync(i, new Date(this.simMs)); this.writeBuffers();
    this.updateSelection(true);
    if (this.label) this.label.textContent = this.objects[i].name;
    if (focus) {
      this.inertial.updateMatrix();
      const p = new THREE.Vector3(this.positions[3 * i], this.positions[3 * i + 1], this.positions[3 * i + 2]).applyMatrix4(this.inertial.matrix), r = p.length();
      if (r > 0) this.focus = { x: Math.asin(p.y / r), y: -Math.PI / 2 - Math.atan2(-p.z, p.x) };
      if (r > 3) this.camDist = Math.max(this.camDist, Math.min(r * 2.2, 60));
    }
    this.onSelect?.(this.objects[i], this.selState);
  }

  indexOf(norad) { return this.objects.findIndex((o) => o.norad === norad); }

  setTime(ms) { this.simMs = ms; this.resyncAll(); this.updateFrames(); this.onTick?.(new Date(this.simMs)); }
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
    this.scene.updateMatrixWorld(); this.camera.updateMatrixWorld();
    const cam = this.camera.position, m = this.inertial.matrixWorld, v = new THREE.Vector3(), w = new THREE.Vector3();
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < this.N; i++) {
      const o = 3 * i; if (!this.positions[o] && !this.positions[o + 1] && !this.positions[o + 2]) continue;
      w.set(this.positions[o], this.positions[o + 1], this.positions[o + 2]).applyMatrix4(m);
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

  // Earth rotation and sun direction for the current simulated time.
  updateFrames() {
    const d = new Date(this.simMs), g = gmst(d);
    this.inertial.rotation.y = -g;
    const s = sunEquatorial(d), H = s.ra - g;
    this.earthUniforms.sun.value.set(Math.cos(s.dec) * Math.cos(H), Math.sin(s.dec), -Math.cos(s.dec) * Math.sin(H));
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dtMs = Math.min(now - this.last, 100); this.last = now;
    if (document.hidden) return;
    if (this.N) {
      if (this.playing && this.speed) {
        this.simMs += dtMs * this.speed;
        this.integrate(dtMs * this.speed / 1000);
      }
      // Refresh a slice of objects from SGP4 so integration error never builds up.
      const d = new Date(this.simMs), slice = Math.ceil(this.N / RESYNC_FRAMES), start = (this.frameNo++ % RESYNC_FRAMES) * slice;
      for (let i = start; i < Math.min(this.N, start + slice); i++) this.resync(i, d);
      this.writeBuffers();
      this.updateSelection();
      if (now - this.lastTick > 250) { this.lastTick = now; this.onTick?.(d); }
    }
    this.updateFrames();
    if (this.focus) {
      let dy = this.focus.y - this.rotY; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const dx = this.focus.x - this.rotX; this.rotY += dy * 0.09; this.rotX += dx * 0.09;
      if (Math.abs(dy) < 0.003 && Math.abs(dx) < 0.003) this.focus = null;
    } else if (this.autoRotate) this.rotY += 0.0006 * (dtMs / 16);
    this.camCur += (this.camDist - this.camCur) * 0.15;
    this.camera.position.set(0, 0, this.camCur);
    this.world.rotation.set(this.rotX, this.rotY, 0);
    // Icons grow a little as you zoom in, so their shapes become readable.
    if (this.satUniforms) this.satUniforms.size.value = 7 * this.PR * Math.min(2.4, Math.max(0.8, 3.6 / this.camCur));
    this.scene.updateMatrixWorld();
    this.earthUniforms.cam.value.copy(this.camera.position);
    this.earth.worldToLocal(this.earthUniforms.cam.value);
    this.earthUniforms.texel.value = 1 / 2048;
    this.renderer.render(this.scene, this.camera);
    this.placeLabel();
  }

  placeLabel() {
    if (!this.label) return;
    if (this.sel < 0 || !this.marker.visible) { this.label.style.display = 'none'; return; }
    const o = 3 * this.sel, w = new THREE.Vector3(this.positions[o], this.positions[o + 1], this.positions[o + 2]).applyMatrix4(this.inertial.matrixWorld);
    const cam = this.camera.position, v = w.clone().sub(cam);
    const a = v.dot(v), b = 2 * cam.dot(v), c = cam.dot(cam) - 1, disc = b * b - 4 * a * c;
    const hidden = disc > 0 && (() => { const t = (-b - Math.sqrt(disc)) / (2 * a); return t > 0 && t < 1; })();
    w.project(this.camera);
    if (hidden || w.z > 1) { this.label.style.display = 'none'; return; }
    const r = this.canvas.getBoundingClientRect();
    this.label.style.display = 'block';
    this.label.style.left = `${(w.x * 0.5 + 0.5) * r.width}px`;
    this.label.style.top = `${(-w.y * 0.5 + 0.5) * r.height}px`;
  }
}

export { satellite };
