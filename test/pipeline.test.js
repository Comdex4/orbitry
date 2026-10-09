import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseTsv, gcatDate } from '../pipeline/lib.js';
import { buildCatalog, recentReentries, lowAndDecaying } from '../pipeline/catalog.js';
import { normalize } from '../pipeline/launches.js';
import { parseVectors } from '../pipeline/horizons.js';
import { buildTargets } from '../pipeline/targets.js';
import { publishedDescriptions, earthModels } from '../pipeline/content.js';
import { decodeCatalog } from '../public/js/lib/catalog.js';

test('CSV parser handles quotes, commas and CRLF', () => {
  const rows = parseCsv('A,B,C\r\n"x, y",2,"say ""hi"""\r\nz,,3\n');
  assert.deepEqual(rows, [{ A: 'x, y', B: '2', C: 'say "hi"' }, { A: 'z', B: '', C: '3' }]);
});

test('GCAT TSV and dates', () => {
  const rows = parseTsv('#JCAT\tSatcat\tLDate\n# Updated\nS25544    \t25544\t1998 Nov 20\n');
  assert.equal(rows[0].Satcat, '25544');
  assert.equal(gcatDate(rows[0].LDate), '1998-11-20');
  assert.equal(gcatDate('1957 Dec  1 1000?'), '1957-12-01');
  assert.equal(gcatDate('-'), null);
});

const gp = [
  { OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-10-08T20:29:05.961408', MEAN_MOTION: 15.4878, ECCENTRICITY: 0.00068, INCLINATION: 51.63, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 50, MEAN_ANOMALY: 10, NORAD_CAT_ID: 25544, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0 },
  { OBJECT_NAME: 'FALLING', OBJECT_ID: '2020-001A', EPOCH: '2026-10-08T00:00:00', MEAN_MOTION: 16.3, ECCENTRICITY: 0.001, INCLINATION: 53, RA_OF_ASC_NODE: 0, ARG_OF_PERICENTER: 0, MEAN_ANOMALY: 0, NORAD_CAT_ID: 45000, BSTAR: 0.001, MEAN_MOTION_DOT: 0.01, MEAN_MOTION_DDOT: 0 }
];
const satcat = [
  { NORAD_CAT_ID: '25544', OBJECT_TYPE: 'PAY', OWNER: 'ISS', LAUNCH_DATE: '1998-11-20', DECAY_DATE: '', RCS: '400', ORBIT_CENTER: 'EA' },
  { NORAD_CAT_ID: '45000', OBJECT_TYPE: 'PAY', OWNER: 'US', LAUNCH_DATE: '2020-01-07', DECAY_DATE: '', RCS: '', ORBIT_CENTER: 'EA' },
  { NORAD_CAT_ID: '40000', OBJECT_NAME: 'GONE', OBJECT_ID: '2014-001A', OBJECT_TYPE: 'DEB', OWNER: 'PRC', LAUNCH_DATE: '2014-01-01', DECAY_DATE: '2026-10-01', RCS: '', ORBIT_CENTER: 'EA' }
];
const gcatSat = [{ JCAT: 'S25544', Satcat: '25544', State: 'US', Owner: 'JSC', Mass: '20281', LDate: '1998 Nov 20' }];
const gcatPsat = [{ JCAT: 'S25544', Category: 'SS' }];
const orgs = [{ Code: 'US', ShortName: 'USA', Name: 'United States of America', EName: 'USA' }, { Code: 'JSC', ShortName: 'NASA JSC', Name: 'NASA Johnson' }];

test('catalog merge joins elements with SATCAT and GCAT', () => {
  const c = buildCatalog({ gp, satcat, gcatSat, gcatPsat, orgs, fetched: { gp: Date.now() } });
  const [iss, other] = decodeCatalog(c);
  assert.equal(iss.operatorName, 'NASA JSC');
  assert.equal(iss.countryName, 'USA');
  assert.equal(iss.purpose, 'human');
  assert.equal(iss.mass, 20281);
  assert.equal(iss.type, 'PAY');
  assert.equal(other.countryName, 'USA'); // falls back to CelesTrak owner code
  assert.equal(other.purpose, 'unknown');
});

test('re-entry lists', () => {
  const recent = recentReentries(satcat, 45, Date.parse('2026-10-09'));
  assert.deepEqual(recent.map((r) => r.norad), [40000]);
  assert.deepEqual(lowAndDecaying(gp, satcat).map((r) => r.norad), [45000]);
});

test('launch normalisation drops unlicensed images', () => {
  const l = normalize({ id: 'x', name: 'A | B', net: '2026-10-10T00:00:00Z', status: { abbrev: 'Go', name: 'Go for Launch' }, image: { image_url: 'u', license: { name: 'Unknown' } }, mission: { name: 'B', orbit: { name: 'LEO', celestial_body: { name: 'Earth' } } }, pad: { name: 'P', latitude: '28.5', longitude: '-80.6', location: { name: 'KSC' } } });
  assert.equal(l.image, null);
  assert.equal(l.lat, 28.5);
  assert.equal(l.orbit, 'LEO');
});

test('Horizons vector parsing', () => {
  const rows = parseVectors('header\n$$SOE\n2461320.500000000, A.D. 2026-Oct-09 00:00:00.0000, 1.0, 2.0, 3.0, 0.1, 0.2, 0.3,\n$$EOE\ntrailer');
  assert.deepEqual(rows, [[2461320.5, 1, 2, 3, 0.1, 0.2, 0.3]]);
  assert.equal(parseVectors('No ephemeris'), null);
});

test('deep-sky targets: Messier objects and bright NGC, not duplicates', () => {
  const head = 'Name;Type;RA;Dec;Const;MajAx;MinAx;PosAng;B-Mag;V-Mag;J-Mag;H-Mag;K-Mag;SurfBr;Hubble;Pax;Pm-RA;Pm-Dec;RadVel;Redshift;Cstar U-Mag;Cstar B-Mag;Cstar V-Mag;M;NGC;IC;Cstar Names;Identifiers;Common names;NED notes;OpenNGC notes;Sources';
  const row = (o) => head.split(';').map((h) => o[h] ?? '').join(';');
  const ngc = [head, row({ Name: 'NGC0224', Type: 'G', RA: '00:42:44.35', Dec: '+41:16:08.6', MajAx: '177.83', 'V-Mag': '3.44', M: '031', 'Common names': 'Andromeda Galaxy' }),
    row({ Name: 'NGC9999', Type: 'G', RA: '01:00:00', Dec: '+01:00:00', MajAx: '1', 'V-Mag': '14' }),
    row({ Name: 'NGC7000', Type: 'HII', RA: '20:59:17.1', Dec: '+44:31:44', MajAx: '120', 'V-Mag': '4' })].join('\n');
  const add = [head, row({ Name: 'M102', Type: 'Dup', RA: '14:03:12', Dec: '+54:20:56', M: '101' })].join('\n');
  const t = buildTargets([ngc, add]);
  assert.deepEqual(t.map((x) => x.id), ['M31', 'NGC 7000']);
  assert.ok(Math.abs(t[0].ra - 10.6848) < 1e-3 && Math.abs(t[0].dec - 41.2691) < 1e-3);
  assert.equal(t[0].name, 'M31 · Andromeda Galaxy');
});

test('only approved descriptions are published', () => {
  const pub = publishedDescriptions([
    { id: 'a', text: 'ok', review: { status: 'approved', by: 'R', on: '2026-10-09' } },
    { id: 'b', text: 'draft', review: { status: 'unreviewed' } },
    { id: 'c', text: 'no', review: { status: 'rejected', by: 'R', on: '2026-10-09' } }
  ]);
  assert.deepEqual(Object.keys(pub), ['a']);
});

test('model matches require the catalog name to agree with the NORAD number', () => {
  const models = { repo: 'nasa/x', commit: 'abc', license: {}, models: { iss: { path: '3D Models/ISS.glb', title: 'ISS' } }, earth: [{ norad: 25544, name: 'ISS', model: 'iss' }, { norad: 1, name: 'HST', model: 'iss' }] };
  const out = earthModels(models, [[25544, 'ISS (ZARYA)'], [1, 'NOT HUBBLE']]);
  assert.deepEqual(Object.keys(out), ['25544']);
  assert.match(out[25544].url, /raw\.githubusercontent\.com\/nasa\/x\/abc\/3D%20Models\/ISS\.glb/);
});
