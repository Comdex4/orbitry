// Cloudflare Pages Function: proxies CelesTrak's active-satellite TLE list and caches it
// for two hours, so visitors hit your cache instead of CelesTrak (which asks for this).
export async function onRequest() {
  const upstream = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
  const res = await fetch(upstream, { cf: { cacheTtl: 7200, cacheEverything: true } });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=7200',
      'access-control-allow-origin': '*'
    }
  });
}
