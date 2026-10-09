import { chrome, $, $$, esc, getJSON, fmtDate, fmtDateTime, ago } from './common.js';
import { epochMs } from '../lib/catalog.js';

chrome();

const TYPE = { PAY: 'Payload', 'R/B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' };
const STATUS = { Go: 'ok', TBC: 'warn', TBD: 'warn', Success: 'ok', Failure: 'bad', 'Partial Failure': 'warn', Hold: 'warn', 'In Flight': 'blue' };

$$('[data-tab]').forEach((b) => (b.onclick = () => {
  $$('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  for (const id of ['up', 'recent', 'down']) $('#' + id).hidden = id !== b.dataset.tab;
  history.replaceState(null, '', '#' + b.dataset.tab);
}));
if (['#recent', '#down'].includes(location.hash)) $(`[data-tab="${location.hash.slice(1)}"]`).click();

function countdown(net) {
  const s = Math.round((Date.parse(net) - Date.now()) / 1000);
  if (s < 0) return 'T+ ' + clock(-s);
  return 'T− ' + clock(s);
}
function clock(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return d ? `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}

function card(l, upcoming) {
  const img = l.image ? `<img src="${esc(l.image.url)}" alt="" loading="lazy" title="${esc([l.image.credit, l.image.license].filter(Boolean).join(' · '))}">` : '<div class="ph"></div>';
  const approx = l.precision && !/Second|Minute/.test(l.precision) ? ` <span class="chip warn" title="Launch Library precision: ${esc(l.precision)}">±${esc(l.precision.toLowerCase())}</span>` : '';
  return `<article class="launch">${img}<div>
    <h3>${esc(l.mission || l.name)}</h3>
    <div class="mute" style="font-size:.88rem">${esc(l.rocket || '')}${l.provider ? ' · ' + esc(l.provider) : ''}</div>
    <div class="dim" style="font-size:.84rem">${esc(l.pad || '')}${l.location ? ', ' + esc(l.location) : ''}${l.orbit && l.orbit !== 'Unknown' ? ' · ' + esc(l.orbit) : ''}${l.destination && l.destination !== 'Earth' ? ' · to ' + esc(l.destination) : ''}</div>
    ${l.description && !/^Details TBD/.test(l.description) ? `<p style="font-size:.86rem;color:#c3cbdb;margin:6px 0 0">${esc(l.description.length > 260 ? l.description.slice(0, 257) + '…' : l.description)}</p>` : ''}
    ${l.fail_reason ? `<p style="font-size:.84rem;color:var(--bad)">${esc(l.fail_reason)}</p>` : ''}
    </div><div class="when">
      <span class="chip ${STATUS[l.status] || ''}" title="${esc(l.status_name || '')}">${esc(l.status_name || l.status || '')}</span>${approx}
      <div style="margin-top:6px">${fmtDateTime(l.net)}</div>
      ${upcoming ? `<div class="cd" data-net="${esc(l.net)}">${countdown(l.net)}</div>` : ''}
      ${l.webcast_live ? '<div class="chip bad">Live now</div>' : ''}
    </div></article>`;
}

try {
  const d = await getJSON('/data/launches.json');
  $('#upList').innerHTML = d.upcoming.map((l) => card(l, true)).join('') || '<p class="mute">No upcoming launches listed.</p>';
  $('#recentList').innerHTML = d.recent.map((l) => card(l, false)).join('');
  $('#upSrc').innerHTML = `Launch data from <a href="${esc(d.source.url)}" rel="noopener">${esc(d.source.name)}</a>, fetched ${ago(d.source.fetched)}. Launch times often slip; check the provider before travelling to watch.`;
  setInterval(() => $$('.cd').forEach((el) => (el.textContent = countdown(el.dataset.net))), 1000);
} catch (e) { $('#upList').innerHTML = `<p class="notice">Launch data could not be loaded (${esc(e.message)}).</p>`; }

try {
  const r = await getJSON('/data/reentries.json');
  $('#reTbl').innerHTML = r.recent.slice(0, 150).map((o) => `<tr><td>${esc(o.name)} <span class="dim">${o.norad}</span></td><td>${esc(TYPE[o.type] || o.type)}</td><td>${esc(o.owner)}</td><td>${fmtDate(o.launch_date)}</td><td>${fmtDate(o.decay_date)}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">None recorded.</td></tr>';
  $('#lowTbl').innerHTML = r.low.map((o) => `<tr><td><a href="/object/?norad=${o.norad}">${esc(o.name)}</a> <span class="dim">${o.norad}</span></td><td>${esc(TYPE[o.type] || o.type || '—')}</td><td class="r num">${o.perigee_km} km</td><td class="r num">${o.apogee_km} km</td><td>${ago(epochMs(o.epoch))}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">Nothing below 220 km right now.</td></tr>';
  $('#downSrc').innerHTML = `From CelesTrak SATCAT and orbital elements; updated ${ago(r.generated)}.`;
} catch (e) { $('#reTbl').innerHTML = `<tr><td colspan="5">Could not load (${esc(e.message)}).</td></tr>`; }
