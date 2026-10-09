// One-paragraph overviews written mechanically from an object's own catalog fields. Every
// object gets one, so no page is left blank; they say nothing the fields don't. Fuller summaries,
// drafted by Claude and checked by a person, replace them once approved.
import { orbitShape } from './catalog.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

const NOUN = { PAY: 'satellite', 'R/B': 'rocket body', DEB: 'piece of debris' };
const PURPOSE = {
  comms: 'communications', earthobs: 'Earth-observation', weather: 'weather', navigation: 'navigation', science: 'science',
  human: 'human-spaceflight', tech: 'technology-test', military: 'military or intelligence'
};
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const km = (v) => Math.round(v).toLocaleString('en-US');
const by = (op, country) => (op && country ? ` operated by ${op} (${country})` : op ? ` operated by ${op}` : country ? ` from ${country}` : '');

const IN_ORBIT = { leo: 'low Earth orbit', meo: 'medium Earth orbit', geo: 'a geosynchronous orbit', heo: 'a highly elliptical orbit' };

export function earthOverview(o) {
  const payload = o.type === 'PAY' || !o.type, noun = NOUN[o.type] || 'object';
  let first;
  if (!payload) first = `${o.name} is ${article(noun)} ${noun}${o.countryName ? ` (catalogued under ${o.countryName})` : ''}.`;
  else if (o.purpose === 'human') first = `${o.name} is a spacecraft used for human spaceflight${by(o.operatorName, o.countryName)}.`;
  else { const what = PURPOSE[o.purpose] ? `${PURPOSE[o.purpose]} ${noun}` : noun; first = `${o.name} is ${article(what)} ${what}${by(o.operatorName, o.countryName)}.`; }
  const out = [first];
  const s = orbitShape(o.mm, o.ecc), orbit = IN_ORBIT[o.orbit];
  const height = s.apogee - s.perigee < 50 ? `about ${km((s.perigee + s.apogee) / 2)} km up` : `between ${km(s.perigee)} and ${km(s.apogee)} km up`;
  const period = s.period < 180 ? `${Math.round(s.period)} minutes` : `${(s.period / 60).toFixed(1)} hours`;
  out.push(`It is in ${orbit}, ${height}, and goes around Earth once every ${period}.`);
  const launched = longDate(o.launch);
  if (launched && o.mass) out.push(`It was launched on ${launched} and has a recorded mass of ${km(o.mass)} kg.`);
  else if (launched) out.push(`It was launched on ${launched}.`);
  else if (o.mass) out.push(`It has a recorded mass of ${km(o.mass)} kg.`);
  return out.join(' ');
}

const KIND = { crewed: 'crewed landing', rover: 'rover mission', lander: 'lander', 'sample-return': 'sample-return mission', impact: 'impact probe' };
const OUTCOME = { success: 'The mission is recorded as a success.', partial: 'The mission is recorded as a partial success.', failure: 'The mission failed.' };

export function siteOverview(r, body) {
  const world = body === 'mars' ? 'Mars' : 'the Moon';
  const launched = longDate(r.launch_date), arrived = longDate(r.arrival_date);
  if (!r.kind) { // orbiter
    const out = [`${r.name} is a spacecraft${by(r.operator, r.country)}.`];
    if (launched && arrived) out.push(`It was launched on ${launched} and arrived in orbit around ${world} on ${arrived}.`);
    return out.join(' ');
  }
  // Past tense only for dated events, so the text stays true for missions still running.
  const what = KIND[r.kind] || r.kind, desc = `${article(what)} ${what} ${r.kind === 'crewed' ? 'on' : 'to'} ${world}${by(r.operator, r.country)}`;
  const out = [launched && arrived
    ? `${r.name}, ${desc}, was launched on ${launched} and ${r.kind === 'impact' ? 'hit the surface' : 'reached the surface'} on ${arrived}.`
    : `${r.name} is ${desc}.`];
  if (OUTCOME[r.outcome]) out.push(OUTCOME[r.outcome]);
  return out.join(' ');
}

export function probeOverview(p) {
  const launched = longDate(p.launch_date);
  return `${p.name} is a deep-space probe${by(p.operator, null)}${launched ? `, launched on ${launched}` : ''}.`;
}
