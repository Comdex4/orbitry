// A landing site in 3D: generated ground, NASA's model of the spacecraft at roughly real size,
// and the sky as seen from there. The ground is illustrative, not the real terrain at the site.
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { chrome, $, esc, getJSON, fmtDate, fail } from './common.js';

chrome({ footer: false });
const D2R = Math.PI / 180;
const [body, slug] = (new URLSearchParams(location.search).get('id') || '').split(':');

/* ---------- small deterministic noise ---------- */
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, o = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };

/* ---------- scene ---------- */
const canvas = $('#canvas'), stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
const controls = new OrbitControls(camera, canvas);
camera.position.set(9, 3.5, 11); controls.target.set(0, 1, 0);
controls.enableDamping = true; controls.minDistance = 2.5; controls.maxDistance = 80; controls.maxPolarAngle = 1.52; controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches; controls.autoRotateSpeed = 0.4;

function resize() { const r = stage.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage); resize();

const MOON = body === 'moon';
const palette = MOON ? { base: [118, 116, 112], var: 46, tint: [1, 1, 1] } : { base: [168, 104, 66], var: 40, tint: [1, 0.92, 0.85] };

function groundTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const n = fbm(i / 64, j / 64, 6) - 0.5, g = (hash(i, j) - 0.5) * 0.35, k = (n + g) * palette.var, o = 4 * (j * S + i);
    img.data[o] = palette.base[0] + k; img.data[o + 1] = palette.base[1] + k * 0.95; img.data[o + 2] = palette.base[2] + k * 0.9; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Ground: rolling noise, craters on the Moon, low dunes on Mars; flat where the craft stands.
function ground() {
  const size = 1600, seg = 360, g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  seed = 7;
  const craters = [];
  for (let i = 0; i < (MOON ? 160 : 30); i++) {
    const r = (MOON ? 2 : 4) + rnd() ** 2.5 * (MOON ? 70 : 50), d = r * 1.6 + 30 + rnd() * 700, a = rnd() * Math.PI * 2; // keep rims clear of the craft
    craters.push([Math.cos(a) * d, Math.sin(a) * d, r]);
  }
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), dist = Math.hypot(x, z);
    let h = (fbm(x / 90, z / 90, 5) - 0.5) * (MOON ? 4 : 9) + (fbm(x / 9, z / 9, 3) - 0.5) * 0.6;
    if (!MOON) h += Math.sin(x / 23 + fbm(x / 60, z / 60) * 6) * 0.6;
    for (const [cx, cz, r] of craters) {
      const t = Math.hypot(x - cx, z - cz) / r;
      if (t < 1) h -= (1 - t * t) * r * 0.22;
      else if (t < 1.6) h += Math.exp(-(((t - 1) * 4) ** 2)) * r * 0.08;
    }
    h *= THREE.MathUtils.smoothstep(dist, 6, 30);   // a level patch for the spacecraft
    h -= dist * dist / (2 * (MOON ? 1737e3 : 3389e3)); // the curve of the world, toward the horizon
    p.setY(i, h);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1, metalness: 0, color: new THREE.Color(...palette.tint) }));
  m.receiveShadow = true;
  scene.add(m);
  // Rocks
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: MOON ? 0x8a8782 : 0x8c5a3c, roughness: 1, flatShading: true }), 900);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  seed = 99;
  for (let i = 0; i < rocks.count; i++) {
    const d = 7 + rnd() ** 1.6 * 160, a = rnd() * Math.PI * 2, s = 0.04 + rnd() ** 5 * 0.75;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3));
    mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.5), s));
    rocks.setMatrixAt(i, mtx);
  }
  rocks.castShadow = rocks.receiveShadow = true;
  return { mesh: m, rocks };
}

// Place rocks on the actual ground surface.
function settle(rocks, groundMesh) {
  const ray = new THREE.Raycaster(), m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < rocks.count; i++) {
    rocks.getMatrixAt(i, m); m.decompose(p, q, s);
    ray.set(new THREE.Vector3(p.x, 100, p.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(groundMesh)[0];
    if (hit) { p.y = hit.point.y + s.y * 0.35; m.compose(p, q, s); rocks.setMatrixAt(i, m); }
  }
  rocks.instanceMatrix.needsUpdate = true;
  scene.add(rocks);
}

function sky(site) {
  if (MOON) {
    // Airless sky: the stars, and Earth hanging over the near side.
    const t = new THREE.TextureLoader().load('/textures/space-skybox.jpg'); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    scene.background = t; scene.backgroundIntensity = 0.9;
    // Earth sits near the sub-Earth point (0°, 0°) in the Moon's sky; elevation = 90° minus the site's angular distance from it.
    const phi = site.lat * D2R, lam = site.lon * D2R;
    const dist = Math.acos(Math.cos(phi) * Math.cos(lam)), el = Math.PI / 2 - dist;
    if (el > -0.02) {
      const az = Math.atan2(Math.sin(-lam), -Math.sin(phi) * Math.cos(-lam));
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      const tex = new THREE.TextureLoader().load('/textures/earth-day.jpg'); tex.colorSpace = THREE.SRGBColorSpace;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(16, 64, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
      earth.position.copy(dir.multiplyScalar(900)); earth.rotation.y = 2.2;
      scene.add(earth);
      return { earthVisible: true, earthEl: el / D2R };
    }
    return { earthVisible: false };
  }
  // Mars daytime: butterscotch near the horizon, darker overhead.
  const g = new THREE.SphereGeometry(3000, 48, 24), m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(vec3(0.86, 0.66, 0.48), vec3(0.42, 0.30, 0.25), pow(h, 0.6)); gl_FragColor = vec4(c, 1.0); }'
  });
  scene.add(new THREE.Mesh(g, m));
  scene.fog = new THREE.Fog(0xcfa27c, 250, 1400);
  return {};
}

function lights() {
  const sun = new THREE.DirectionalLight(0xffffff, MOON ? 3.2 : 2.6);
  sun.position.set(-60, MOON ? 26 : 45, 40); // a low Sun throws long shadows
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 300 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(MOON ? 0x30343c : 0xe8c6a4, MOON ? 0x111111 : 0x553322, MOON ? 0.25 : 0.7));
  return sun;
}

async function loadModel(model) {
  const draco = new DRACOLoader().setDecoderPath('/vendor/three/draco/');
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(model.url);
  draco.dispose();
  const obj = gltf.scene;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  const k = (model.height_m || 2) / Math.max(size.y, 1e-6);
  obj.scale.setScalar(k);
  const b2 = new THREE.Box3().setFromObject(obj), c = b2.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  scene.add(obj);
  return new THREE.Box3().setFromObject(obj);
}

let home;
function frameView(box) {
  const h = box.max.y - box.min.y, r = Math.max(h, box.max.x - box.min.x, box.max.z - box.min.z);
  controls.target.set(0, h * 0.45, 0);
  camera.position.set(r * 1.6, h * 0.7 + 1.2, r * 1.9);
  home = { p: camera.position.clone(), t: controls.target.clone() };
  controls.update();
}

$('#spin').onclick = (e) => { controls.autoRotate = !controls.autoRotate; e.target.setAttribute('aria-pressed', String(controls.autoRotate)); };
$('#reset').onclick = () => { if (home) { camera.position.copy(home.p); controls.target.copy(home.t); controls.update(); } };

function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); }

try {
  if (!['moon', 'mars'].includes(body) || !slug) throw new Error('No site given');
  const data = await getJSON(`/data/${body}.json`);
  const site = data.sites.find((s) => s.slug === slug);
  if (!site) throw new Error('No such site');
  document.title = `${site.name} in 3D — Orbitry`;
  const OUT = { success: 'Success', partial: 'Partial success', failure: 'Failed' };
  $('#card').innerHTML = `<h1>${esc(site.name)}</h1>
    <p class="sub">${body === 'moon' ? 'The Moon' : 'Mars'} · ${Math.abs(site.lat).toFixed(3)}° ${site.lat >= 0 ? 'N' : 'S'}, ${Math.abs(site.lon).toFixed(3)}° ${site.lon >= 0 ? 'E' : 'W'}</p>
    <dl class="facts"><dt>Operator</dt><dd>${esc(site.operator)}</dd><dt>Arrived</dt><dd>${fmtDate(site.arrival_date)}</dd><dt>Outcome</dt><dd>${esc(OUT[site.outcome] || '')}</dd></dl>
    <div class="row" style="margin-top:12px"><a class="btn small primary" href="/object/?id=${body}:${esc(slug)}">About this mission</a><a class="btn small" href="/${body}/?site=${esc(slug)}">Back to ${body === 'moon' ? 'the Moon' : 'Mars'}</a></div>`;
  if (!site.model) throw new Error('There is no 3D model for this spacecraft yet.');
  const skyInfo = sky(site);
  lights();
  const g = ground();
  loop();
  const box = await loadModel(site.model);
  frameView(box);
  settle(g.rocks, g.mesh);
  $('#loading').hidden = true;
  $('#note').innerHTML = `Illustrative scene: the ground and lighting are generated, not the real terrain at this site. ${esc(site.model.title)} is NASA's 3D model, shown at roughly real size.${site.model.note ? ' ' + esc(site.model.note) : ''}${MOON ? (skyInfo.earthVisible ? ` Earth hangs about ${Math.round(skyInfo.earthEl)}° above the horizon here; its position is approximate.` : ' Earth is below the horizon here.') : ''}`;
} catch (e) { fail($('#loading'), e.message); }
