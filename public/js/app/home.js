// Landing page: a live hero globe and a strip of live numbers, all from the same data the site uses.
import { chrome, $, $$, getJSON, loadCatalog, ago, session } from './common.js';
import { Globe } from './globe.js';
import { stateAt, describe, lightTime } from '../lib/ephemeris.js';

// Old links to the globe used the site root (/?norad=25544); send them to its new home.
if (/[?&](norad|color|t)=/.test(location.search)) location.replace('/globe/' + location.search);

chrome();
const set = (id, text, sub) => { const el = $(id); if (el) el.textContent = text; if (sub && $(id + 'Sub')) $(id + 'Sub').textContent = sub; };

const globe = new Globe($('#heroGlobe'), { interactive: false, autoRotate: true });
globe.camDist = globe.camCur = 3.1;

loadCatalog().then(({ raw, objects }) => {
  globe.setObjects(objects);
  globe.setColoring('purpose');
  const n = objects.length.toLocaleString();
  set('#sObjects', n);
  $$('[data-n="objects"]').forEach((el) => (el.textContent = `all ${n} active satellites`));
  const fetched = raw.sources.elements.fetched;
  if (fetched) set('#sFresh', ago(fetched));
  $('#heroTag').textContent = `${n} objects · positions computed live in your browser`;
}).catch(() => { $('#heroTag').textContent = 'Open the live globe'; });

Promise.all([getJSON('/data/moon.json'), getJSON('/data/mars.json')])
  .then(([m, r]) => set('#sSites', `${m.sites.length} + ${r.sites.length}`)).catch(() => {});

getJSON('/data/descriptions.json').then((d) => { const n = String(Object.keys(d).length); set('#sSummaries', n); set('#sReviewed', n); }).catch(() => {});

getJSON('/data/solar-system.json').then((ss) => {
  const v = ss.bodies.find((b) => b.slug === 'voyager-1'), e = ss.bodies.find((b) => b.name === 'Earth');
  const tick = () => {
    const s = v && stateAt(v.v, Date.now()), es = e && stateAt(e.v, Date.now());
    if (!s || !es) return;
    const d = describe(s, es);
    set('#sVoyager', lightTime(d.lightSec), `to reach Earth, ${Math.round(d.earthKm / 1e9 * 10) / 10} billion km away`);
  };
  tick(); setInterval(tick, 60000);
}).catch(() => {});

getJSON('/data/launches.json').then((l) => {
  const next = l.upcoming.find((x) => Date.parse(x.net) > Date.now());
  if (!next) return;
  const mission = next.mission && !/^Unknown/i.test(next.mission) ? next.mission : null;
  const label = [mission, next.rocket].filter(Boolean).join(' · ') || next.name;
  const tick = () => {
    const s = Math.max(0, Math.round((Date.parse(next.net) - Date.now()) / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    set('#sLaunch', d ? `T− ${d}d ${h}h ${m}m` : `T− ${h}h ${String(m).padStart(2, '0')}m`, label);
  };
  tick(); setInterval(tick, 30000);
}).catch(() => {});

// Server features (accounts, alerts, API keys, the paid planner) say "Live" once the Worker is deployed.
session().then(({ server }) => {
  if (!server) return;
  $$('[data-server]').forEach((c) => { c.textContent = 'Live'; c.classList.add('ok'); $('#liveList').append(c.closest('li')); });
});
