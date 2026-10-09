// Upcoming and recent launches from The Space Devs' Launch Library 2.
// The free tier allows 15 requests an hour; we make two every few hours.
import { cachedFetch } from './lib.js';

const BASE = 'https://ll.thespacedevs.com/2.3.0/launches/';

export async function fetchLaunches() {
  const [up, prev] = await Promise.all([
    cachedFetch('ll2-upcoming.json', BASE + 'upcoming/?limit=40&mode=normal&hide_recent_previous=true', 3),
    cachedFetch('ll2-previous.json', BASE + 'previous/?limit=25&mode=normal', 3)
  ]);
  return {
    generated: new Date().toISOString(),
    source: { name: 'The Space Devs — Launch Library 2', url: 'https://thespacedevs.com/llapi', fetched: new Date(Math.min(up.fetchedAt, prev.fetchedAt)).toISOString() },
    upcoming: JSON.parse(up.text).results.map(normalize),
    recent: JSON.parse(prev.text).results.map(normalize)
  };
}

export function normalize(l) {
  const m = l.mission || {}, pad = l.pad || {}, img = l.image || null;
  return {
    id: l.id, name: l.name, net: l.net, window_start: l.window_start, window_end: l.window_end,
    precision: l.net_precision?.name || null,
    status: l.status?.abbrev || null, status_name: l.status?.name || null, fail_reason: l.failreason || null,
    provider: l.launch_service_provider?.name || null, rocket: l.rocket?.configuration?.full_name || null,
    mission: m.name || null, mission_type: m.type || null, description: m.description || null,
    orbit: m.orbit?.name || null, destination: m.orbit?.celestial_body?.name || null,
    pad: pad.name || null, location: pad.location?.name || null,
    lat: pad.latitude != null ? Number(pad.latitude) : null, lon: pad.longitude != null ? Number(pad.longitude) : null,
    image: img && img.license && img.license.name !== 'Unknown'
      ? { url: img.thumbnail_url || img.image_url, credit: img.credit || null, license: img.license.name, license_url: img.license.link || null }
      : null,
    webcast_live: !!l.webcast_live,
    source_url: l.url
  };
}
