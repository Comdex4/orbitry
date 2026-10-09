// Curated content: Moon and Mars sites, deep-space probes, 3D models and reviewed descriptions.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT, readContent, cachedFetch } from './lib.js';

export async function loadContent() {
  const [moon, mars, deep, models] = await Promise.all(['moon.json', 'mars.json', 'deep-space.json', 'models.json'].map(readContent));
  return { moon, mars, deep, models, descriptions: await loadDescriptions() };
}

export async function loadDescriptions() {
  const dir = path.join(CONTENT, 'descriptions'), out = [];
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')); } catch {}
  for (const f of files) out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
  return out;
}

// Only approved descriptions leave the repository.
export function publishedDescriptions(all) {
  const out = {};
  for (const d of all) {
    if (d.review?.status !== 'approved' || !d.text) continue;
    out[d.id] = { text: d.text, sources: d.sources || [], drafted_by: d.drafted_by || null, reviewed_by: d.review.by, reviewed_on: d.review.on };
  }
  return out;
}

export function modelUrl(models, key) {
  const m = models.models[key];
  if (!m) return null;
  const p = m.path.split('/').map(encodeURIComponent).join('/');
  return { url: `https://raw.githubusercontent.com/${models.repo}/${models.commit}/${p}`, title: m.title, note: m.note || null, license: models.license, source: `https://github.com/${models.repo}` };
}

// NORAD → model, keeping only matches whose catalog name confirms the number.
export function earthModels(models, catalogRows) {
  const names = new Map(catalogRows.map((r) => [r[0], r[1]]));
  const out = {}, dropped = [];
  for (const e of models.earth) {
    const n = names.get(e.norad);
    if (n && n.toUpperCase().includes(e.name)) out[e.norad] = modelUrl(models, e.model);
    else dropped.push(e.norad);
  }
  if (dropped.length) console.log(`  models: ${dropped.length} not in the active catalog (${dropped.join(', ')})`);
  return out;
}

export const wikiTitle = (t) => decodeURIComponent(t).replace(/_/g, ' ');

// English Wikipedia titles → Wikidata QIDs, for looking up freely licensed photos.
export async function qidsForTitles(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50).map(wikiTitle);
    const qs = new URLSearchParams({ action: 'query', format: 'json', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: batch.join('|') });
    const r = await cachedFetch(`enwiki-qids-${i}-${batch.length}-${batch[0].length}.json`, `https://en.wikipedia.org/w/api.php?${qs}`, 24 * 30);
    const q = JSON.parse(r.text).query || {};
    const back = new Map();
    for (const n of q.normalized || []) back.set(n.to, n.from);
    for (const rd of q.redirects || []) back.set(rd.to, back.get(rd.from) || rd.from);
    for (const p of Object.values(q.pages || {})) {
      const qid = p.pageprops?.wikibase_item;
      if (qid) out[back.get(p.title) || p.title] = qid;
    }
  }
  return out;
}
