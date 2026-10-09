// Draft plain-language descriptions with Claude, strictly from Orbitry's own records.
// Drafts are saved to content/descriptions/ as "unreviewed" and are NOT published until a
// person approves them with `npm run review`.
//
//   ANTHROPIC_API_KEY=... node scripts/draft-descriptions.js --curated        Moon, Mars and deep-space records without a draft
//   ANTHROPIC_API_KEY=... node scripts/draft-descriptions.js --norad 25544,20580
//   add --force to redraft records that already have a description
import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CONTENT, OUT, readContent } from '../pipeline/lib.js';
import { decodeCatalog, publicObject } from '../public/js/lib/catalog.js';

const MODEL = 'claude-opus-5-5';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const Draft = z.object({
  sentences: z.array(z.object({
    text: z.string(),
    // Keys (dotted paths) of the record fields this sentence relies on.
    supported_by: z.array(z.string())
  })),
  omitted: z.string() // anything the writer wanted to say but the record did not support
});

const SYSTEM = `You write short descriptions of spacecraft and space objects for Orbitry, a public website.
Rules:
- Use ONLY facts present in the JSON record you are given. Do not add anything from your own knowledge, even if you are confident it is true: no dates, numbers, purposes, outcomes or names that are not in the record.
- Write 2 to 4 sentences of plain language for a curious general reader. No jargon without a short explanation. No hype.
- For each sentence, list the record fields that support it, as dotted paths (for example "launch_date", "orbit.perigee_km", "facts[0]").
- If the record is too thin for two sentences, write one.
- Put anything you wanted to say but could not support in "omitted".`;

function strip(r) {
  // Only factual fields go to the model; review metadata and media do not.
  const { review, photo, model, wikidata, ...rest } = r;
  return rest;
}

function getPath(obj, p) {
  return p.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

async function existing(id) {
  try { return JSON.parse(await fs.readFile(path.join(CONTENT, 'descriptions', `${id}.json`), 'utf8')); } catch { return null; }
}

async function main() {
  const jobs = [];
  if (flag('--curated')) {
    const [moon, mars, deep] = await Promise.all(['moon.json', 'mars.json', 'deep-space.json'].map(readContent));
    for (const r of [...moon.sites, ...moon.orbiters]) jobs.push({ id: `moon-${r.slug}`, record: strip(r) });
    for (const r of [...mars.sites, ...mars.orbiters]) jobs.push({ id: `mars-${r.slug}`, record: strip(r) });
    for (const r of deep.probes) jobs.push({ id: `probe-${r.slug}`, record: strip(r) });
  }
  if (opt('--norad')) {
    const cat = decodeCatalog(JSON.parse(await fs.readFile(path.join(OUT, 'catalog.json'), 'utf8')));
    const by = new Map(cat.map((o) => [o.norad, o]));
    for (const n of opt('--norad').split(',').map(Number)) {
      const o = by.get(n);
      if (!o) { console.warn(`NORAD ${n} is not in the current catalog; run the pipeline first.`); continue; }
      const { elements, ...facts } = publicObject(o);
      jobs.push({ id: `norad-${n}`, record: facts });
    }
  }
  if (!jobs.length) { console.log('Nothing to draft. Use --curated and/or --norad <ids>.'); return; }

  const client = new Anthropic();
  await fs.mkdir(path.join(CONTENT, 'descriptions'), { recursive: true });
  for (const job of jobs) {
    const prev = await existing(job.id);
    if (prev && !flag('--force')) continue;
    process.stdout.write(`${job.id} … `);
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Draft) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Record:\n${JSON.stringify(job.record, null, 2)}` }]
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) { console.log(`skipped (${res.stop_reason})`); continue; }
    const draft = res.parsed_output;
    // Mechanical check: every cited field must exist in the record. A draft that cites
    // something missing is still saved, but flagged so the reviewer looks harder.
    const missing = draft.sentences.flatMap((s) => s.supported_by.filter((p) => getPath(job.record, p) === undefined));
    const doc = {
      id: job.id,
      text: draft.sentences.map((s) => s.text).join(' '),
      sentences: draft.sentences,
      omitted: draft.omitted || null,
      record: job.record,
      sources: job.record.sources || [],
      drafted_by: `Claude (${res.model})`,
      drafted_at: new Date().toISOString(),
      checks: { unsupported_citations: missing },
      review: { status: 'unreviewed' }
    };
    await fs.writeFile(path.join(CONTENT, 'descriptions', `${job.id}.json`), JSON.stringify(doc, null, 2) + '\n');
    console.log(missing.length ? `drafted, ${missing.length} citation(s) need checking` : 'drafted');
  }
  console.log('\nDrafts are unpublished until approved: npm run review');
}

main().catch((e) => {
  if (e instanceof Anthropic.AuthenticationError) console.error('Set ANTHROPIC_API_KEY (or log in with `ant auth login`).');
  else if (e instanceof Anthropic.RateLimitError) console.error('Rate limited; try again shortly.');
  else console.error(e);
  process.exit(1);
});
