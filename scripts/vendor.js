// Copy browser builds of runtime libraries into public/vendor so pages, Web Workers and the
// Cloudflare Worker all import the same files by relative path (no import maps, no bundler).
//   node scripts/vendor.js   (run after changing satellite.js or three versions)
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'public', 'vendor', ...p);

async function copyJs(src, dst) {
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { if (e.name !== 'wasm') await copyJs(s, d); }
    else if (e.name.endsWith('.js')) { await fs.mkdir(dst, { recursive: true }); await fs.copyFile(s, d); }
  }
}

await fs.rm(out(), { recursive: true, force: true });
await copyJs(nm('satellite.js', 'dist'), out('satellite.js'));
// The optional WebAssembly bulk propagator relies on package.json "imports" aliases that only a
// bundler or Node can resolve; Orbitry doesn't use it, so drop it from the browser copy.
const idx = out('satellite.js', 'index.js');
await fs.writeFile(idx, (await fs.readFile(idx, 'utf8')).replace(/^export \* from '\.\/wasm\/index\.js';\n?/m, ''));
await fs.copyFile(nm('satellite.js', 'LICENSE.md'), out('satellite.js', 'LICENSE.md')).catch(() => {});
await fs.mkdir(out('three'), { recursive: true });
for (const f of ['three.module.min.js', 'three.core.min.js']) await fs.copyFile(nm('three', 'build', f), out('three', f));
await fs.copyFile(nm('three', 'LICENSE'), out('three', 'LICENSE'));
// Add-ons used by the landing-site viewer. Their bare "three" imports are rewritten to the
// vendored build so they load without an import map.
for (const f of ['loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'controls/OrbitControls.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js']) {
  const src = await fs.readFile(nm('three', 'examples', 'jsm', f), 'utf8');
  await fs.mkdir(path.dirname(out('three', 'addons', f)), { recursive: true });
  await fs.writeFile(out('three', 'addons', f), src.replace(/from 'three';/g, "from '../../three.module.min.js';"));
}
// NASA's models are Draco-compressed; the decoder (wasm + JS fallback) is loaded on demand.
await fs.mkdir(out('three', 'draco'), { recursive: true });
for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) await fs.copyFile(nm('three', 'examples', 'jsm', 'libs', 'draco', 'gltf', f), out('three', 'draco', f));
const pkg = async (n) => JSON.parse(await fs.readFile(nm(n, 'package.json'), 'utf8')).version;
await fs.writeFile(out('VERSIONS.json'), JSON.stringify({ 'satellite.js': await pkg('satellite.js'), three: await pkg('three') }, null, 2) + '\n');
console.log('vendored into public/vendor');
