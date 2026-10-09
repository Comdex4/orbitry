// Object pages: Earth-orbit objects (?norad=25544) and curated records (?id=moon:apollo-11,
// ?id=mars:curiosity, ?id=probe:voyager-1).
import { chrome, $, esc, getJSON, loadCatalog, fmtDate, ago, km, reviewChip, sourcesList, photoFigure, me, api, session } from './common.js';
import { ORBITS, PURPOSES, TYPES, orbitShape, epochMs } from '../lib/catalog.js';
import { satrecFor, stateAt, groundTrack, accuracyNote, ageDays } from '../lib/orbit.js';
import { stateAt as ephState, describe as ephDescribe, lightTime } from '../lib/ephemeris.js';
import { earthOverview, siteOverview, probeOverview } from '../lib/overview.js';

chrome();
const params = new URLSearchParams(location.search), main = $('#main');
const descriptions = getJSON('/data/descriptions.json').catch(() => ({}));

function summaryBlock(id, desc, overview) {
  const d = desc[id];
  if (!d) return `<p class="summary">${esc(overview)}</p><p class="dim" style="font-size:.8rem">Written automatically from the facts on this page. A fuller summary, drafted by Claude from the sourced records and checked by a person, replaces it once it has been reviewed.</p>`;
  return `<p class="summary">${esc(d.text)}</p><p class="dim" style="font-size:.8rem">Drafted by ${esc(d.drafted_by || 'Claude')} from the sourced records on this page; reviewed by ${esc(d.reviewed_by)} on ${esc(d.reviewed_on)}.</p>`;
}

function modelBlock(m) {
  if (!m) return '';
  if (!customElements.get('model-viewer')) {
    const s = document.createElement('script'); s.type = 'module';
    s.src = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js'; document.head.append(s);
  }
  return `<figure><model-viewer src="${esc(m.url)}" alt="3D model of ${esc(m.title)}" camera-controls auto-rotate shadow-intensity="0.6" exposure="1.1" loading="lazy"></model-viewer>
    <figcaption>3D model: ${esc(m.title)}${m.note ? ' · ' + esc(m.note) : ''} · <a href="${esc(m.source)}" rel="noopener">NASA 3D Resources</a> · <a href="${esc(m.license.url)}" rel="noopener">${esc(m.license.name)}</a></figcaption></figure>`;
}

const row = (k, v, cls = '') => (v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${esc(v)}</dd>`);

async function earthObject(norad) {
  const [{ raw, objects }, media, models, desc] = await Promise.all([loadCatalog(), getJSON('/data/media.json').catch(() => ({ norad: {} })), getJSON('/data/models.json').catch(() => ({})), descriptions]);
  const o = objects.find((x) => x.norad === norad);
  if (!o) {
    main.innerHTML = `<h1>NORAD ${norad}</h1><p class="lede">This object isn't in Orbitry's current catalog of active objects. It may have re-entered, be classified as inactive debris, or not be publicly tracked.</p><p><a href="/launches/#down">Recent re-entries</a> · <a href="https://celestrak.org/satcat/search.php" rel="noopener">Search CelesTrak SATCAT</a></p>`;
    return;
  }
  document.title = `${o.name} — Orbitry`;
  const s = orbitShape(o.mm, o.ecc), photo = media.norad?.[norad], model = models[norad];
  const gp = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=json`;
  const sources = [
    { title: 'Orbital elements: CelesTrak GP', url: gp },
    { title: 'Catalog record: CelesTrak SATCAT', url: `https://celestrak.org/satcat/table-satcat.php?CATNR=${norad}` },
    { title: "Operator, purpose and mass: Jonathan McDowell's GCAT", url: 'https://planet4589.org/space/gcat/', license: 'CC BY 4.0' },
    ...(photo?.wikidata ? [{ title: `Wikidata ${photo.wikidata}`, url: `https://www.wikidata.org/wiki/${photo.wikidata}`, license: 'CC0' }] : [])
  ];
  main.innerHTML = `
    <p class="kicker">Earth orbit · ${esc(ORBITS[o.orbit].label)}</p>
    <div class="obj-head">
      <div>
        <h1>${esc(o.name)}</h1>
        <p class="mute">NORAD ${o.norad}${o.intl ? ' · COSPAR ' + esc(o.intl) : ''}${o.type ? ' · ' + esc(TYPES[o.type] || o.type) : ''}</p>
        <div class="row" style="margin:14px 0 20px">
          <a class="btn primary" href="/globe/?norad=${norad}">Show on globe</a>
          <a class="btn" href="/passes/?norad=${norad}">When can I see it?</a>
          <a class="btn" href="/api/v1/objects/${norad}">JSON</a>
          <button class="btn" id="fav" hidden type="button">☆ Favorite</button>
        </div>
        <h2>Summary</h2>
        ${summaryBlock('norad-' + norad, desc, earthOverview(o))}
        <h2>Key facts</h2>
        <dl class="facts left" style="max-width:560px">
          ${row('Operator', o.operatorName)}${row('Country', o.countryName)}${row('Purpose', PURPOSES[o.purpose].label)}
          ${row('Launch date', o.launch ? fmtDate(o.launch) : null)}${row('Mass', o.mass ? `${o.mass.toLocaleString()} kg` : null)}
          ${row('Status', 'In CelesTrak’s active set (believed operational)')}
        </dl>
        <h2>Orbit</h2>
        <dl class="facts left" style="max-width:560px" id="orbitDl">
          ${row('Type', ORBITS[o.orbit].label)}${row('Period', s.period < 1440 ? `${s.period.toFixed(1)} min` : `${(s.period / 60).toFixed(2)} h`)}
          ${row('Perigee', km(s.perigee))}${row('Apogee', km(s.apogee))}${row('Inclination', `${o.inc.toFixed(2)}°`)}${row('Eccentricity', o.ecc.toFixed(5))}
          ${row('Element epoch', new Date(epochMs(o.epoch)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC')}
          ${row('Data age', `${ageDays(o).toFixed(1)} days`, ageDays(o) > 7 ? 'warn' : '')}
        </dl>
        <p class="notice" style="max-width:640px">${esc(accuracyNote(o).text)} Public elements are not suitable for collision avoidance or precise pointing.</p>
        <h2>Right now</h2>
        <dl class="facts left" id="now" style="max-width:560px"></dl>
        <h3>Ground track, next three hours</h3>
        <canvas id="track" width="1200" height="600" aria-label="Map of the object's ground track for the next three hours"></canvas>
      </div>
      <div class="media">${photoFigure(photo, o.name)}${modelBlock(model)}${!photo && !model ? '<p class="dim">No freely licensed photo or 3D model is on record for this object.</p>' : ''}</div>
    </div>
    <h2>Sources</h2>${sourcesList(sources)}
    <p class="dim" style="font-size:.82rem">Catalog built ${ago(raw.generated)}. Elements fetched ${raw.sources.elements.fetched ? ago(raw.sources.elements.fetched) : '—'}.</p>`;
  const rec = satrecFor(o);
  const tick = () => {
    const st = stateAt(rec, new Date());
    $('#now').innerHTML = st ? row('Altitude', km(st.alt)) + row('Speed', `${st.speed.toFixed(2)} km/s`) + row('Over', `${Math.abs(st.lat).toFixed(2)}° ${st.lat >= 0 ? 'N' : 'S'}, ${Math.abs(st.lon).toFixed(2)}° ${st.lon >= 0 ? 'E' : 'W'}`) : row('Position', 'Cannot be computed from these elements');
  };
  tick(); setInterval(tick, 1000);
  session().then(({ server }) => { if (!server) main.querySelector('a[href^="/api/v1"]')?.remove(); });
  drawTrack(rec);
  favButton(norad);
}

async function favButton(norad) {
  if (!(await me())) return;
  const b = $('#fav'); b.hidden = false;
  let on = false;
  try { on = (await getJSON('/api/favorites')).favorites.some((f) => f.norad === norad); } catch {}
  const label = () => (b.textContent = on ? '★ Favorite' : '☆ Favorite');
  label();
  b.onclick = async () => { await api(`/api/favorites/${norad}`, on ? 'DELETE' : 'PUT'); on = !on; label(); };
}

function drawTrack(rec) {
  const c = $('#track'), x = c.getContext('2d'), img = new Image();
  img.onload = () => {
    x.drawImage(img, 0, 0, c.width, c.height);
    x.fillStyle = 'rgba(5,7,13,.35)'; x.fillRect(0, 0, c.width, c.height);
    const P = ([la, lo]) => [(lo + 180) / 360 * c.width, (90 - la) / 180 * c.height];
    x.strokeStyle = '#5cc8ff'; x.lineWidth = 2.5;
    for (const seg of groundTrack(rec, new Date(), 180, 30)) { x.beginPath(); seg.forEach((p, i) => { const [a, b] = P(p); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke(); }
    const st = stateAt(rec, new Date());
    if (st) { const [a, b] = P([st.lat, st.lon]); x.fillStyle = '#fff'; x.beginPath(); x.arc(a, b, 7, 0, 7); x.fill(); }
  };
  img.src = '/textures/earth-day.jpg';
}

async function curated(kind, slug) {
  const [desc] = await Promise.all([descriptions]);
  let r, ctx = '';
  if (kind === 'probe') {
    const [pr, ss] = await Promise.all([getJSON('/data/probes.json'), getJSON('/data/solar-system.json').catch(() => null)]);
    r = pr.probes.find((p) => p.slug === slug);
    if (r && ss) {
      const b = ss.bodies.find((x) => x.slug === slug), e = ss.bodies.find((x) => x.name === 'Earth');
      const s = b && ephState(b.v, Date.now()), es = e && ephState(e.v, Date.now());
      if (s) {
        const d = ephDescribe(s, es);
        ctx = `<h2>Where it is now</h2><dl class="facts left" style="max-width:560px">${row('Distance from Earth', `${Math.round(d.earthKm).toLocaleString()} km (${d.earthAU.toFixed(2)} AU)`)}${row('Distance from the Sun', `${d.sunAU.toFixed(2)} AU`)}${row('One-way light time', lightTime(d.lightSec))}${row('Speed relative to the Sun', `${d.speedKms.toFixed(2)} km/s`)}</dl>
          ${r.position_note ? `<p class="notice">${esc(r.position_note)}</p>` : ''}<p class="dim" style="font-size:.82rem">From NASA/JPL Horizons, updated ${ago(ss.generated)}. <a href="/solar-system/?probe=${esc(slug)}">See it on the deep-space map</a>.</p>`;
      }
    }
  } else {
    const d = await getJSON(`/data/${kind}.json`);
    r = d.sites.find((s) => s.slug === slug);
    if (r) ctx = `<p><a class="btn" href="/${kind}/?site=${esc(slug)}">Show on the ${kind === 'moon' ? 'Moon' : 'Mars'} globe</a></p>`;
    else { r = d.orbiters.find((s) => s.slug === slug); if (r) r.isOrbiter = true; }
  }
  if (!r) { main.innerHTML = '<h1>Not found</h1><p class="lede">No record matches this link.</p>'; return; }
  document.title = `${r.name} — Orbitry`;
  const KIND = { crewed: 'Crewed landing', rover: 'Rover', lander: 'Lander', 'sample-return': 'Sample return', impact: 'Impact site' };
  const where = kind === 'probe' ? 'Deep space' : `${kind === 'moon' ? 'Moon' : 'Mars'} · ${r.isOrbiter ? 'In orbit' : KIND[r.kind] || r.kind}`;
  const OUT = { success: 'Success', partial: 'Partial success', failure: 'Failed' };
  main.innerHTML = `
    <p class="kicker">${esc(where)}</p>
    <div class="obj-head"><div>
      <h1>${esc(r.name)}</h1>
      <p style="margin:10px 0 18px">${reviewChip(r)}</p>
      <h2>Summary</h2>${summaryBlock(`${kind}-${slug}`, desc, kind === 'probe' ? probeOverview(r) : siteOverview(r.isOrbiter ? { ...r, kind: undefined } : r, kind))}
      <h2>Key facts</h2>
      <dl class="facts left" style="max-width:560px">
        ${row('Mission', r.mission)}${row('Operator', r.operator)}${row('Country', r.country)}${row('Launched', r.launch_date && fmtDate(r.launch_date))}
        ${row(r.isOrbiter ? 'Arrived in orbit' : r.kind === 'impact' ? 'Impact' : 'Arrived', r.arrival_date && fmtDate(r.arrival_date))}
        ${row('Outcome', OUT[r.outcome])}
        ${r.lat != null ? row('Coordinates', `${Math.abs(r.lat).toFixed(3)}° ${r.lat >= 0 ? 'N' : 'S'}, ${Math.abs(r.lon).toFixed(3)}° ${r.lon >= 0 ? 'E' : 'W'} (planetocentric)`) : ''}
      </dl>
      ${r.facts?.length ? `<ul style="padding-left:18px;max-width:640px">${r.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${r.status_note ? `<p class="notice">${esc(r.status_note)}</p>` : ''}
      ${ctx}
    </div><div class="media">${photoFigure(r.photo, r.name)}${modelBlock(r.model)}${!r.photo && !r.model ? '<p class="dim">No freely licensed photo or 3D model is on record.</p>' : ''}</div></div>
    <h2>Sources</h2>${sourcesList([...(r.sources || []), ...(r.wikidata ? [{ title: `Wikidata ${r.wikidata}`, url: `https://www.wikidata.org/wiki/${r.wikidata}`, license: 'CC0' }] : [])])}
    <p class="dim" style="font-size:.82rem">${r.review?.status === 'approved' ? `Reviewed by ${esc(r.review.by)} on ${esc(r.review.on)}.` : 'This record was compiled from the sources above and is awaiting review by a second person. If you spot an error, please tell us.'}</p>`;
}

try {
  const n = +params.get('norad'), id = params.get('id');
  if (n) await earthObject(n);
  else if (id && /^(moon|mars|probe):[\w-]+$/.test(id)) await curated(...id.split(':'));
  else main.innerHTML = '<h1>Find an object</h1><p class="lede">Search on the <a href="/globe/">globe</a>, or browse the <a href="/moon/">Moon</a>, <a href="/mars/">Mars</a> and <a href="/solar-system/">deep space</a>.</p>';
} catch (e) { main.innerHTML = `<p class="notice">This page could not be loaded (${esc(e.message)}).</p>`; }
