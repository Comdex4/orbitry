// Small HTTP helpers for the Worker.
export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data, null, init.pretty ? 2 : 0), { ...init, headers });
}

export function errorResponse(e) {
  const status = e instanceof HttpError ? e.status : 500;
  if (status === 500) console.error(e?.stack || e);
  return json({ error: status === 500 ? 'Internal error' : e.message, ...(e?.extra || {}) }, { status });
}

export async function readJson(req, max = 32 * 1024) {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'Request body too large');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'Body must be JSON'); }
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(name, value, { maxAge, path = '/' } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax${maxAge != null ? `; Max-Age=${maxAge}` : ''}`;
}

export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-api-key, content-type', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' };

export function withHeaders(res, headers) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
  return r;
}

export async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const nowIso = () => new Date().toISOString();

export function num(v, { min = -Infinity, max = Infinity, name = 'value', required = true } = {}) {
  if (v == null || v === '') { if (required) throw new HttpError(400, `${name} is required`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be a number between ${min} and ${max}`);
  return n;
}

export function str(v, { max = 200, name = 'value', required = true } = {}) {
  if (v == null || v === '') { if (required) throw new HttpError(400, `${name} is required`); return null; }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${name} must be text up to ${max} characters`);
  return v.trim();
}
