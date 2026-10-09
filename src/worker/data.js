// Read the pipeline's static JSON through the assets binding, cached per isolate.
import { decodeCatalog } from '../../public/js/lib/catalog.js';

const cache = new Map();
const TTL = 5 * 60 * 1000;

export async function asset(env, name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const res = await env.ASSETS.fetch(new Request(`https://assets.local/data/${name}`));
  if (!res.ok) throw new Error(`Missing data file ${name} (${res.status})`);
  const v = await res.json();
  cache.set(name, { v, t: Date.now() });
  return v;
}

export async function catalog(env) {
  const raw = await asset(env, 'catalog.json');
  const hit = cache.get('catalog:decoded');
  if (hit && hit.raw === raw) return hit.v;
  const objects = decodeCatalog(raw), byNorad = new Map(objects.map((o) => [o.norad, o]));
  const v = { raw, objects, byNorad };
  cache.set('catalog:decoded', { raw, v, t: Date.now() });
  return v;
}
