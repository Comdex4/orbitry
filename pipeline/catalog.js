// Earth-orbit catalog: CelesTrak orbital elements + CelesTrak SATCAT + Jonathan McDowell's GCAT.
import { cachedFetch, parseTsv, parseCsv, gcatDate } from './lib.js';
import { COLS, CATALOG_VERSION, purposeFromCategory, orbitShape } from '../public/js/lib/catalog.js';

export const SOURCES = {
  gp: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json',
  satcat: 'https://celestrak.org/pub/satcat.csv',
  gcatSat: 'https://planet4589.org/space/gcat/tsv/cat/satcat.tsv',
  gcatPsat: 'https://planet4589.org/space/gcat/tsv/cat/psatcat.tsv',
  gcatOrgs: 'https://planet4589.org/space/gcat/tsv/tables/orgs.tsv'
};

// Used only when GCAT has no state for an object.
const CELESTRAK_OWNER = {
  US: 'USA', CIS: 'Russia', PRC: 'China', UK: 'United Kingdom', FR: 'France', JPN: 'Japan', IND: 'India',
  ESA: 'European Space Agency', GER: 'Germany', IT: 'Italy', CA: 'Canada', SKOR: 'South Korea', SPN: 'Spain',
  TURK: 'Turkey', AUS: 'Australia', ROC: 'Taiwan', ARGN: 'Argentina', NOR: 'Norway', FIN: 'Finland', ISRA: 'Israel',
  UAE: 'United Arab Emirates', BRAZ: 'Brazil', SING: 'Singapore', INDO: 'Indonesia', SAUD: 'Saudi Arabia',
  IRAN: 'Iran', EGYP: 'Egypt', POL: 'Poland', TBD: 'Not yet determined'
};

export async function fetchCatalogSources() {
  const [gp, satcat, gcatSat, gcatPsat, gcatOrgs] = await Promise.all([
    cachedFetch('gp-active.json', SOURCES.gp, 2),
    cachedFetch('celestrak-satcat.csv', SOURCES.satcat, 24),
    cachedFetch('gcat-satcat.tsv', SOURCES.gcatSat, 24),
    cachedFetch('gcat-psatcat.tsv', SOURCES.gcatPsat, 24),
    cachedFetch('gcat-orgs.tsv', SOURCES.gcatOrgs, 24 * 7)
  ]);
  return {
    gp: JSON.parse(gp.text), satcat: parseCsv(satcat.text), gcatSat: parseTsv(gcatSat.text),
    gcatPsat: parseTsv(gcatPsat.text), orgs: parseTsv(gcatOrgs.text),
    fetched: { gp: gp.fetchedAt, satcat: satcat.fetchedAt, gcat: gcatSat.fetchedAt }
  };
}

function dict() {
  const list = [], index = new Map();
  return {
    list,
    add(code, name) {
      if (!code || !name) return null;
      if (!index.has(code)) { index.set(code, list.length); list.push([code, name]); }
      return index.get(code);
    }
  };
}

const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };

// Pure merge step, kept separate from fetching so it can be tested on fixtures.
export function buildCatalog({ gp, satcat, gcatSat, gcatPsat, orgs, fetched }) {
  const cs = new Map(satcat.map((r) => [Number(r.NORAD_CAT_ID), r]));
  const gs = new Map();
  for (const r of gcatSat) { const n = Number(r.Satcat); if (n) gs.set(n, r); }
  const ps = new Map(gcatPsat.map((r) => [r.JCAT, r]));
  const org = new Map(orgs.map((r) => [r.Code, r]));
  const countries = dict(), operators = dict();
  const orgName = (code, preferLong) => {
    const o = org.get(code);
    if (!o) return null;
    const pick = preferLong ? [o.EName, o.ShortEName, o.Name, o.ShortName] : [o.ShortName, o.ShortEName, o.Name];
    return pick.find((x) => x && x !== '-') || null;
  };

  const rows = [];
  for (const e of gp) {
    const norad = Number(e.NORAD_CAT_ID);
    const c = cs.get(norad), g = gs.get(norad), p = g ? ps.get(g.JCAT) : null;
    const stateCode = g && g.State && g.State !== '-' ? g.State : null;
    let country = null;
    if (stateCode) country = countries.add(stateCode, orgName(stateCode, true) || stateCode);
    else if (c && c.OWNER) country = countries.add('CT:' + c.OWNER, CELESTRAK_OWNER[c.OWNER] || c.OWNER);
    const opCode = g && g.Owner && g.Owner !== '-' ? g.Owner : null;
    const operator = opCode ? operators.add(opCode, orgName(opCode, false) || opCode) : null;
    const mass = g ? num(g.Mass) : null;
    rows.push([
      norad, e.OBJECT_NAME, e.OBJECT_ID || null, e.EPOCH, e.MEAN_MOTION, e.ECCENTRICITY, e.INCLINATION,
      e.RA_OF_ASC_NODE, e.ARG_OF_PERICENTER, e.MEAN_ANOMALY, e.BSTAR, e.MEAN_MOTION_DOT, e.MEAN_MOTION_DDOT,
      c ? c.OBJECT_TYPE || null : null, country, operator,
      purposeFromCategory(p && p.Category), (c && c.LAUNCH_DATE) || (g && gcatDate(g.LDate)) || null,
      mass && mass > 0 ? mass : null, c ? num(c.RCS) : null
    ]);
  }
  if (rows[0] && rows[0].length !== COLS.length) throw new Error('Catalog row/column mismatch');
  return {
    v: CATALOG_VERSION, generated: new Date().toISOString(),
    sources: {
      elements: { name: 'CelesTrak GP (active)', url: SOURCES.gp, fetched: iso(fetched?.gp) },
      satcat: { name: 'CelesTrak SATCAT', url: SOURCES.satcat, fetched: iso(fetched?.satcat) },
      gcat: { name: "Jonathan McDowell's General Catalog of Artificial Space Objects (GCAT)", url: 'https://planet4589.org/space/gcat/', license: 'CC BY 4.0', fetched: iso(fetched?.gcat) }
    },
    cols: COLS, dict: { country: countries.list, operator: operators.list }, rows
  };
}

const iso = (t) => (t ? new Date(t).toISOString() : null);

// Objects whose decay was recorded in the last `days` days (CelesTrak SATCAT).
export function recentReentries(satcat, days = 45, now = Date.now()) {
  const since = new Date(now - days * 864e5).toISOString().slice(0, 10);
  return satcat
    .filter((r) => r.DECAY_DATE && r.DECAY_DATE >= since && r.ORBIT_CENTER === 'EA')
    .map((r) => ({
      norad: Number(r.NORAD_CAT_ID), name: r.OBJECT_NAME, intl: r.OBJECT_ID, type: r.OBJECT_TYPE,
      owner: CELESTRAK_OWNER[r.OWNER] || r.OWNER, launch_date: r.LAUNCH_DATE || null, decay_date: r.DECAY_DATE,
      rcs_m2: num(r.RCS)
    }))
    .sort((a, b) => (a.decay_date < b.decay_date ? 1 : -1));
}

// Still-orbiting objects that are low and losing altitude quickly. No dates are predicted:
// public elements can't support a credible re-entry time, so we only rank by how low they are.
export function lowAndDecaying(gp, satcat) {
  const cs = new Map(satcat.map((r) => [Number(r.NORAD_CAT_ID), r]));
  return gp
    .map((e) => ({ e, s: orbitShape(e.MEAN_MOTION, e.ECCENTRICITY) }))
    .filter(({ e, s }) => s.perigee < 220 && e.MEAN_MOTION_DOT > 0.0005)
    .map(({ e, s }) => {
      const c = cs.get(Number(e.NORAD_CAT_ID));
      return {
        norad: Number(e.NORAD_CAT_ID), name: e.OBJECT_NAME, intl: e.OBJECT_ID, epoch: e.EPOCH,
        perigee_km: Math.round(s.perigee), apogee_km: Math.round(s.apogee), type: c?.OBJECT_TYPE || null,
        owner: c ? CELESTRAK_OWNER[c.OWNER] || c.OWNER : null, rcs_m2: c ? num(c.RCS) : null
      };
    })
    .sort((a, b) => a.perigee_km - b.perigee_km);
}
