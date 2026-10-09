// Compare curated Moon and Mars coordinates with Wikidata and list disagreements for review.
//   node scripts/check-sites.js
import { readContent, cachedFetch } from '../pipeline/lib.js';
import { qidsForTitles, wikiTitle } from '../pipeline/content.js';

const GLOBE = { moon: 'Q405', mars: 'Q111' };
const TOL = 0.5;

for (const body of ['moon', 'mars']) {
  const c = await readContent(`${body}.json`);
  const qids = await qidsForTitles(c.sites.map((s) => s.wikipedia));
  const list = [...new Set(Object.values(qids))];
  const query = `SELECT ?item ?lat ?lon WHERE { VALUES ?item { ${list.map((q) => 'wd:' + q).join(' ')} }
    ?item p:P625/psv:P625 [ wikibase:geoGlobe wd:${GLOBE[body]}; wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon ] . }`;
  const r = await cachedFetch(`wd-coords-${body}.json`, `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, 24,
    { headers: { accept: 'application/sparql-results+json' } });
  const wd = new Map();
  for (const b of JSON.parse(r.text).results.bindings) {
    const q = b.item.value.split('/').pop();
    let lon = Number(b.lon.value);
    if (lon > 180) lon -= 360;
    (wd.get(q) || wd.set(q, []).get(q)).push([Number(b.lat.value), lon]);
  }
  console.log(`\n${body.toUpperCase()}`);
  let n = 0;
  for (const s of c.sites) {
    const q = qids[wikiTitle(s.wikipedia)], pts = q ? wd.get(q) : null;
    if (!pts) { console.log(`  ?  ${s.name}: no coordinates on Wikidata (${q || 'no item'})`); continue; }
    const best = pts.map(([la, lo]) => [la, lo, Math.hypot(la - s.lat, ((lo - s.lon + 540) % 360) - 180)]).sort((a, b) => a[2] - b[2])[0];
    if (best[2] > TOL) { n++; console.log(`  ✗  ${s.name}: ours ${s.lat}, ${s.lon} vs Wikidata ${best[0].toFixed(3)}, ${best[1].toFixed(3)} (Δ ${best[2].toFixed(2)}°)`); }
    else console.log(`  ✓  ${s.name}`);
  }
  console.log(`  ${n} disagreement(s) over ${TOL}°`);
}
