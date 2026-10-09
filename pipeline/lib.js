// Small helpers for the data pipeline: polite cached downloads and table parsing.
import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const CACHE = path.join(ROOT, '.cache');
export const OUT = path.join(ROOT, 'public', 'data');
export const CONTENT = path.join(ROOT, 'content');
export const UA = 'Orbitry/1.0 (+https://orbitry.net; data pipeline)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download `url` unless a cached copy younger than `maxAgeH` hours exists.
 * Falls back to a stale cached copy if the network fails, so one bad upstream
 * does not take the whole site's data down. Returns { text, fetchedAt, stale }.
 */
export async function cachedFetch(name, url, maxAgeH, init = {}) {
  await fs.mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, name), meta = file + '.meta.json';
  let cached = null;
  try { cached = JSON.parse(await fs.readFile(meta, 'utf8')); } catch {}
  if (cached && Date.now() - cached.fetchedAt < maxAgeH * 3600e3) {
    return { text: await fs.readFile(file, 'utf8'), fetchedAt: cached.fetchedAt, stale: false };
  }
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000), ...init, headers: { 'user-agent': UA, ...(init.headers || {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      const fetchedAt = Date.now();
      await fs.writeFile(file, text);
      await fs.writeFile(meta, JSON.stringify({ url, fetchedAt }));
      return { text, fetchedAt, stale: false };
    } catch (e) {
      lastErr = e;
      if (/HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) break;
      await sleep(2000 * 2 ** attempt);
    }
  }
  if (cached) {
    console.warn(`  ! ${name}: ${lastErr.message}; using cached copy from ${new Date(cached.fetchedAt).toISOString()}`);
    return { text: await fs.readFile(file, 'utf8'), fetchedAt: cached.fetchedAt, stale: true };
  }
  throw lastErr;
}

// GCAT TSV: '#'-prefixed header line, comment lines, padded fields.
export function parseTsv(text) {
  const lines = text.split('\n');
  const header = lines[0].replace(/^#/, '').split('\t').map((s) => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l[0] === '#') continue;
    const f = l.split('\t'), o = {};
    for (let k = 0; k < header.length; k++) o[header[k]] = (f[k] ?? '').trim();
    rows.push(o);
  }
  return rows;
}

// RFC 4180-ish CSV (CelesTrak SATCAT has quoted names with commas).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// GCAT dates: "1998 Nov 20", "2000 Jul 12 0506", "1957 Dec  1 1000?" → "YYYY-MM-DD" or null.
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
export function gcatDate(s) {
  const m = /^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})/.exec(s || '');
  return m && MON[m[2]] ? `${m[1]}-${MON[m[2]]}-${m[3].padStart(2, '0')}` : null;
}

export async function writeJson(name, data) {
  await fs.mkdir(OUT, { recursive: true });
  const file = path.join(OUT, name);
  await fs.writeFile(file, JSON.stringify(data));
  const { size } = await fs.stat(file);
  console.log(`  wrote data/${name} (${(size / 1024).toFixed(0)} KB)`);
}

export async function readContent(name) {
  return JSON.parse(await fs.readFile(path.join(CONTENT, name), 'utf8'));
}
