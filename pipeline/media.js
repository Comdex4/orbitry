// Photos for objects, from Wikidata (which object has which image) and Wikimedia Commons
// (who made it and under what license). Only freely licensed images with a recorded license
// are kept; anything without license metadata is dropped rather than guessed.
import { cachedFetch, UA } from './lib.js';

const SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const FREE = /^(public domain|pd|cc0|cc[ -]by(-sa)?[ -]?\d|cc[ -]by(-sa)?$)/i;

async function sparql(name, query) {
  const r = await cachedFetch(name, `${SPARQL}?format=json&query=${encodeURIComponent(query)}`, 24 * 7,
    { headers: { accept: 'application/sparql-results+json' } });
  return JSON.parse(r.text).results.bindings;
}

const fileName = (uri) => decodeURIComponent(uri.split('/Special:FilePath/')[1] || '').replace(/_/g, ' ');
const clean = (u) => u && u.split('?')[0];
const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// License and attribution for Commons files, 50 per request.
async function commonsInfo(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const qs = new URLSearchParams({
      action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800',
      titles: batch.map((f) => 'File:' + f).join('|')
    });
    const key = `commons-${hash(batch.join('|'))}.json`;
    const r = await cachedFetch(key, `${COMMONS}?${qs}`, 24 * 7, { headers: { 'user-agent': UA } });
    const pages = JSON.parse(r.text).query?.pages || {};
    for (const p of Object.values(pages)) {
      const ii = p.imageinfo?.[0], m = ii?.extmetadata;
      if (!ii || !m) continue;
      const license = m.LicenseShortName?.value || null;
      if (!license || !FREE.test(license)) continue;
      out.set(p.title.replace(/^File:/, ''), {
        url: clean(ii.thumburl || ii.url), full: clean(ii.url), page: ii.descriptionurl,
        license, license_url: m.LicenseUrl?.value || null,
        author: strip(m.Artist?.value) || null, credit: strip(m.Credit?.value) || null,
        title: strip(m.ObjectName?.value) || null
      });
    }
  }
  return out;
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/**
 * Images keyed by NORAD number (Earth-orbit objects with a Wikidata "Satellite Catalog Number")
 * and by Wikidata QID (for curated Moon, Mars and deep-space records).
 */
export async function fetchMedia(qids, keepNorad = null) {
  const bySat = await sparql('wd-scn-images.json', 'SELECT ?item ?scn ?image WHERE { ?item wdt:P377 ?scn . ?item wdt:P18 ?image . }');
  const byQid = qids.length
    ? await sparql(`wd-qid-images-${hash(qids.join(','))}.json`, `SELECT ?item ?image WHERE { VALUES ?item { ${qids.map((q) => 'wd:' + q).join(' ')} } ?item wdt:P18 ?image . }`)
    : [];
  const files = [...new Set([...bySat, ...byQid].map((b) => fileName(b.image.value)))].filter(Boolean);
  const info = await commonsInfo(files);
  const norad = {}, qid = {};
  for (const b of bySat) {
    const n = Number(b.scn.value), i = info.get(fileName(b.image.value));
    if (n && i && !norad[n] && (!keepNorad || keepNorad.has(n))) norad[n] = { ...i, wikidata: b.item.value.split('/').pop() };
  }
  for (const b of byQid) {
    const q = b.item.value.split('/').pop(), i = info.get(fileName(b.image.value));
    if (i && !qid[q]) qid[q] = { ...i, wikidata: q };
  }
  return { generated: new Date().toISOString(), source: { name: 'Wikidata and Wikimedia Commons', url: 'https://commons.wikimedia.org' }, norad, qid };
}
