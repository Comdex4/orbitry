// The merged Earth-orbit catalog: how it is encoded on disk, how it is decoded, and how
// objects are grouped (orbit type, purpose) for coloring and filtering.
// Shared by the browser, the Worker API and the data pipeline, so it must stay dependency-free.

export const CATALOG_VERSION = 1;

// Column order of each row in catalog.json. Elements are CelesTrak OMM fields.
export const COLS = [
  'norad', 'name', 'intl', 'epoch', 'mm', 'ecc', 'inc', 'raan', 'argp', 'ma', 'bstar', 'ndot', 'nddot',
  'type', 'country', 'operator', 'purpose', 'launch', 'mass', 'rcs'
];

export const ORBITS = {
  leo: { label: 'Low Earth orbit', short: 'LEO', color: '#e9eef8', note: 'Below 2,000 km' },
  meo: { label: 'Medium Earth orbit', short: 'MEO', color: '#ffb454', note: '2,000 km up to geosynchronous' },
  geo: { label: 'Geosynchronous', short: 'GEO', color: '#ff5fa2', note: 'One orbit per sidereal day' },
  heo: { label: 'Highly elliptical', short: 'HEO', color: '#b48cff', note: 'Eccentricity above 0.25' }
};

// Purpose groups, mapped from the mission category in Jonathan McDowell's GCAT.
export const PURPOSES = {
  comms: { label: 'Communications', color: '#5cc8ff' },
  earthobs: { label: 'Earth observation', color: '#6be3a4' },
  weather: { label: 'Weather', color: '#8be9fd' },
  navigation: { label: 'Navigation', color: '#ffd166' },
  science: { label: 'Science', color: '#b48cff' },
  human: { label: 'Human spaceflight', color: '#ff7a59' },
  tech: { label: 'Technology & test', color: '#c9d1e0' },
  military: { label: 'Military & intelligence', color: '#ff5fa2' },
  unknown: { label: 'Not recorded', color: '#5b6478' }
};

const GCAT_PURPOSE = {
  COM: 'comms', IMG: 'earthobs', 'IMG-R': 'earthobs', EOSCI: 'earthobs', GEOD: 'earthobs',
  MET: 'weather', 'MET-RO': 'weather', NAV: 'navigation', SCI: 'science', AST: 'science', PLAN: 'science',
  SS: 'human', CREW: 'human', TECH: 'tech', CAL: 'tech', BIO: 'science', MGRAV: 'science', RV: 'tech',
  SIG: 'military', EW: 'military', WEAPON: 'military', TARG: 'military', SAR: 'comms'
};

export const TYPES = { PAY: 'Payload', 'R/B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' };

// GCAT categories look like "COM", "COM/MET-RO", "SIG?*": the primary is the first token.
export function purposeFromCategory(cat) {
  if (!cat || cat === '-') return 'unknown';
  const primary = String(cat).split('/')[0].replace(/[?*]/g, '').trim();
  return GCAT_PURPOSE[primary] || 'unknown';
}

const MU = 398600.4418, RE = 6378.137;

// Semi-major axis (km) from mean motion in revolutions per day.
export function semiMajorAxis(mm) {
  const n = mm * 2 * Math.PI / 86400;
  return Math.cbrt(MU / (n * n));
}

export function orbitShape(mm, ecc) {
  const a = semiMajorAxis(mm);
  return { a, perigee: a * (1 - ecc) - RE, apogee: a * (1 + ecc) - RE, period: 1440 / mm };
}

export function classifyOrbit(mm, ecc) {
  const { perigee, apogee, period } = orbitShape(mm, ecc);
  if (ecc > 0.25) return 'heo';
  if (apogee < 2000 || (perigee < 2000 && ecc < 0.1)) return 'leo';
  if (period > 1300 && period < 1600) return 'geo';
  return period >= 1600 ? 'geo' : 'meo';
}

// Decode catalog.json into plain objects. Dictionary-coded columns are expanded.
export function decodeCatalog(json) {
  if (!json || json.v !== CATALOG_VERSION) throw new Error('Unsupported catalog version');
  const idx = Object.fromEntries(json.cols.map((c, i) => [c, i]));
  const { country = [], operator = [] } = json.dict || {};
  return json.rows.map((r) => {
    const o = {};
    for (const c of json.cols) o[c] = r[idx[c]];
    o.countryName = o.country != null ? (country[o.country] || [])[1] || null : null;
    o.countryCode = o.country != null ? (country[o.country] || [])[0] || null : null;
    o.operatorName = o.operator != null ? (operator[o.operator] || [])[1] || null : null;
    o.operatorCode = o.operator != null ? (operator[o.operator] || [])[0] || null : null;
    o.orbit = classifyOrbit(o.mm, o.ecc);
    o.purpose = o.purpose || 'unknown';
    return o;
  });
}

// The OMM record satellite.js expects. CelesTrak epochs have no zone; they are UTC.
export function toOMM(o) {
  return {
    OBJECT_NAME: o.name, OBJECT_ID: o.intl || '', EPOCH: o.epoch, NORAD_CAT_ID: o.norad,
    MEAN_MOTION: o.mm, ECCENTRICITY: o.ecc, INCLINATION: o.inc, RA_OF_ASC_NODE: o.raan,
    ARG_OF_PERICENTER: o.argp, MEAN_ANOMALY: o.ma, BSTAR: o.bstar,
    MEAN_MOTION_DOT: o.ndot, MEAN_MOTION_DDOT: o.nddot, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
    ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0
  };
}

export function epochMs(epoch) {
  return Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(epoch) ? epoch : epoch + 'Z');
}

// Objects launched together share the launch part of the international designator (e.g. 2026-123).
export function launchGroup(intl) {
  const m = /^(\d{4}-\d{3})/.exec(intl || '');
  return m ? m[1] : null;
}

export function publicObject(o) {
  const s = orbitShape(o.mm, o.ecc);
  return {
    norad: o.norad, name: o.name, intl: o.intl || null, type: TYPES[o.type] || null,
    country: o.countryName, operator: o.operatorName, purpose: PURPOSES[o.purpose].label,
    launch_date: o.launch || null, mass_kg: o.mass ?? null,
    orbit: {
      class: ORBITS[o.orbit].label, epoch: new Date(epochMs(o.epoch)).toISOString(),
      period_min: round(s.period, 2), perigee_km: Math.round(s.perigee), apogee_km: Math.round(s.apogee),
      inclination_deg: o.inc, eccentricity: o.ecc
    },
    elements: toOMM(o)
  };
}

function round(v, d) { const k = 10 ** d; return Math.round(v * k) / k; }
