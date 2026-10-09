// Deep-sky targets for the astrophotography planner, from OpenNGC (CC BY-SA 4.0):
// every Messier object plus bright, reasonably large NGC/IC objects.
import { cachedFetch } from './lib.js';

const BASE = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/';
const TYPES = {
  G: 'Galaxy', GPair: 'Galaxy pair', GTrpl: 'Galaxy triplet', GGroup: 'Galaxy group', OCl: 'Open cluster', GCl: 'Globular cluster',
  PN: 'Planetary nebula', HII: 'Emission nebula', EmN: 'Emission nebula', RfN: 'Reflection nebula', Neb: 'Nebula', SNR: 'Supernova remnant',
  'Cl+N': 'Cluster with nebula', '*Ass': 'Stellar association', DrkN: 'Dark nebula', '**': 'Double star', Other: 'Other'
};

function parse(text) {
  const [head, ...rows] = text.trim().split('\n');
  const h = head.split(';');
  return rows.map((r) => Object.fromEntries(r.split(';').map((v, i) => [h[i], v])));
}

const hms = (s) => { const [a, b, c] = s.split(':').map(Number); return (a + b / 60 + c / 3600) * 15; };
const dms = (s) => { const sign = s.trim().startsWith('-') ? -1 : 1; const [a, b, c] = s.replace(/^[+-]/, '').split(':').map(Number); return sign * (a + b / 60 + c / 3600); };

export async function fetchTargets() {
  const [ngc, add] = await Promise.all([cachedFetch('openngc-ngc.csv', BASE + 'NGC.csv', 24 * 30), cachedFetch('openngc-addendum.csv', BASE + 'addendum.csv', 24 * 30)]);
  return { text: [ngc.text, add.text], fetched: ngc.fetchedAt };
}

export function buildTargets([ngcText, addText]) {
  const rows = [...parse(ngcText), ...parse(addText)];
  const out = [];
  for (const r of rows) {
    if (!r.RA || !r.Dec || r.Type === 'Dup' || r.Type === 'NonEx') continue;
    const mag = parseFloat(r['V-Mag']) || parseFloat(r['B-Mag']) || null, size = parseFloat(r.MajAx) || null;
    const messier = r.M ? `M${Number(r.M)}` : null;
    const bright = mag != null && mag <= 9 && size != null && size >= 4 && TYPES[r.Type] && r.Type !== '**';
    if (!messier && !bright) continue;
    const id = messier || r.Name.replace(/^(NGC|IC)0*/, '$1 ');
    const common = (r['Common names'] || '').split(',')[0].trim();
    out.push({
      id, name: common ? `${id} · ${common}` : id, catalog: r.Name, type: TYPES[r.Type] || r.Type, const: r.Const,
      ra: Math.round(hms(r.RA) * 1e4) / 1e4, dec: Math.round(dms(r.Dec) * 1e4) / 1e4, mag, size_arcmin: size
    });
  }
  const isM = (t) => /^M\d+$/.test(t.id);
  out.sort((a, b) => (isM(a) !== isM(b) ? (isM(a) ? -1 : 1) : isM(a) ? parseInt(a.id.slice(1)) - parseInt(b.id.slice(1)) : a.id.localeCompare(b.id, 'en', { numeric: true })));
  const seen = new Set();
  return out.filter((t) => !seen.has(t.id) && seen.add(t.id));
}
