// Test doubles for the Worker's bindings: D1 on node:sqlite, assets from a fixtures folder.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const FIXTURES = path.join(ROOT, 'test', 'fixtures');

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v))); }
  async first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async run() {
    if (/\bRETURNING\b/i.test(this.sql)) return { results: this.db.prepare(this.sql).all(...this.params), meta: { changes: 1 } };
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }
}

export function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of fs.readdirSync(path.join(ROOT, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
  return { prepare: (sql) => new Stmt(db, sql), raw: db };
}

export function assets(dir = path.join(FIXTURES)) {
  return {
    async fetch(req) {
      const p = path.join(dir, decodeURIComponent(new URL(req.url).pathname));
      if (!p.startsWith(dir) || !fs.existsSync(p)) return new Response('not found', { status: 404 });
      return new Response(fs.readFileSync(p), { headers: { 'content-type': 'application/json' } });
    }
  };
}

export function makeEnv(extra = {}) {
  const emails = [];
  return { DB: d1(), ASSETS: assets(), SITE_URL: 'https://orbitry.test', EMAIL_FROM: 'Orbitry <test@orbitry.test>', IP_SALT: 't', emails, ...extra };
}

// Capture "sent" emails: without RESEND_API_KEY the Worker logs them to console.log.
export async function captureEmails(fn) {
  const log = console.log, out = [];
  console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[email to ')) out.push(s); else log(...a); };
  try { await fn(); } finally { console.log = log; }
  return out;
}

export const fixtureJson = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'data', name), 'utf8'));
