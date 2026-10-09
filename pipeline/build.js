// Builds everything in public/data/ from upstream sources and the curated content folder.
// Each step fails independently: if one upstream is down, the others still publish, and
// meta.json records what happened so the site can say how fresh each dataset is.
//
//   node pipeline/build.js              all steps
//   node pipeline/build.js --skip-slow  skip photos and Horizons unless cached
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJson, CACHE } from './lib.js';
import { fetchCatalogSources, buildCatalog, recentReentries, lowAndDecaying } from './catalog.js';
import { fetchLaunches } from './launches.js';
import { fetchSolarSystem } from './horizons.js';
import { fetchMedia } from './media.js';
import { fetchTargets, buildTargets } from './targets.js';
import { loadContent, publishedDescriptions, earthModels, modelUrl, qidsForTitles, wikiTitle } from './content.js';

const skipSlow = process.argv.includes('--skip-slow');
const meta = { generated: new Date().toISOString(), steps: {} };

async function step(name, fn) {
  const t = Date.now();
  console.log(`• ${name}`);
  try {
    const info = await fn();
    meta.steps[name] = { ok: true, ms: Date.now() - t, ...info };
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    meta.steps[name] = { ok: false, error: e.message };
  }
}

const content = await loadContent();
let catalog = null;

await step('catalog', async () => {
  const src = await fetchCatalogSources();
  catalog = buildCatalog(src);
  await writeJson('catalog.json', catalog);
  await writeJson('reentries.json', {
    generated: new Date().toISOString(),
    source: { name: 'CelesTrak SATCAT and GP', url: 'https://celestrak.org/satcat/' },
    recent: recentReentries(src.satcat),
    low: lowAndDecaying(src.gp, src.satcat)
  });
  // SQL for the element-history table (applied to D1 by the deploy workflow).
  await fs.writeFile(path.join(CACHE, 'history.sql'), historySql(src.gp));
  return { objects: catalog.rows.length, elements_fetched: catalog.sources.elements.fetched };
});

await step('launches', async () => {
  const l = await fetchLaunches();
  await writeJson('launches.json', l);
  return { upcoming: l.upcoming.length, recent: l.recent.length };
});

await step('solar-system', async () => {
  if (skipSlow && !(await exists('solar-system.json'))) throw new Error('skipped (--skip-slow)');
  const s = await fetchSolarSystem(content.deep.probes.map((p) => ({ id: p.horizons, slug: p.slug, name: p.name })));
  await writeJson('solar-system.json', s);
  return { bodies: s.bodies.length };
});

await step('targets', async () => {
  const t = await fetchTargets(), targets = buildTargets(t.text);
  await writeJson('targets.json', { generated: new Date().toISOString(), source: { name: 'OpenNGC by Mattia Verga', url: 'https://github.com/mattiaverga/OpenNGC', license: 'CC BY-SA 4.0' }, targets });
  return { targets: targets.length };
});

let media = { norad: {}, qid: {} }, qids = {};
await step('media', async () => {
  const titles = [...content.moon.sites, ...content.moon.orbiters, ...content.mars.sites, ...content.mars.orbiters, ...content.deep.probes].map((r) => r.wikipedia).filter(Boolean);
  qids = await qidsForTitles([...new Set(titles)]);
  if (skipSlow) return { skipped: true };
  media = await fetchMedia([...new Set(Object.values(qids))], catalog ? new Set(catalog.rows.map((r) => r[0])) : null);
  await writeJson('media.json', media);
  return { satellites: Object.keys(media.norad).length, curated: Object.keys(media.qid).length };
});

await step('content', async () => {
  const withExtras = (r) => {
    const qid = r.wikipedia ? qids[wikiTitle(r.wikipedia)] : null;
    return { ...r, wikidata: qid || null, photo: (qid && media.qid[qid]) || null, model: r.model ? modelUrl(content.models, r.model) : null };
  };
  for (const body of ['moon', 'mars']) {
    const c = content[body];
    await writeJson(`${body}.json`, { ...c, sites: c.sites.map(withExtras), orbiters: c.orbiters.map(withExtras) });
  }
  await writeJson('probes.json', { probes: content.deep.probes.map(withExtras) });
  await writeJson('models.json', catalog ? earthModels(content.models, catalog.rows) : {});
  const pub = publishedDescriptions(content.descriptions);
  await writeJson('descriptions.json', pub);
  return { descriptions_published: Object.keys(pub).length, descriptions_pending: content.descriptions.length - Object.keys(pub).length };
});

await writeJson('meta.json', meta);
const failed = Object.entries(meta.steps).filter(([, s]) => !s.ok).map(([k]) => k);
if (failed.includes('catalog')) { console.error('Catalog step failed; not safe to deploy.'); process.exit(1); }
if (failed.length) console.warn(`Finished with failures in: ${failed.join(', ')}`);

async function exists(name) { try { await fs.access(path.join('public/data', name)); return true; } catch { return false; } }

function historySql(gp) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const lines = ['-- generated by pipeline/build.js'];
  for (let i = 0; i < gp.length; i += 200) {
    const vals = gp.slice(i, i + 200).map((e) => `(${Number(e.NORAD_CAT_ID)},${q(e.EPOCH)},${q(JSON.stringify(e))})`);
    lines.push(`INSERT OR IGNORE INTO element_history (norad, epoch, omm) VALUES ${vals.join(',')};`);
  }
  return lines.join('\n') + '\n';
}
