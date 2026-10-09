// Review drafted descriptions. Nothing Claude drafts is published until someone approves it here.
//   node scripts/review.js --by "Your Name"
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execSync } from 'node:child_process';
import { CONTENT } from '../pipeline/lib.js';

const dir = path.join(CONTENT, 'descriptions');
const i = process.argv.indexOf('--by');
let by = i >= 0 ? process.argv[i + 1] : null;
if (!by) { try { by = execSync('git config user.name').toString().trim(); } catch {} }
if (!by) { console.error('Pass --by "Your Name" so approvals record who reviewed them.'); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
let pending = 0;
for (const f of files) {
  const file = path.join(dir, f), d = JSON.parse(await fs.readFile(file, 'utf8'));
  if (d.review?.status !== 'unreviewed') continue;
  pending++;
  console.log(`\n━━ ${d.id} ━━  (drafted by ${d.drafted_by} on ${d.drafted_at?.slice(0, 10)})`);
  console.log('\nRecord it was drafted from:\n' + JSON.stringify(d.record, null, 2));
  console.log('\nDraft, with the fields each sentence cites:');
  for (const s of d.sentences || [{ text: d.text, supported_by: [] }]) console.log(`  • ${s.text}\n      ← ${s.supported_by.join(', ') || '(none)'}`);
  if (d.checks?.unsupported_citations?.length) console.log(`\n  ⚠ cites fields not in the record: ${d.checks.unsupported_citations.join(', ')}`);
  if (d.omitted) console.log(`\n  Left out (unsupported): ${d.omitted}`);
  const a = (await rl.question('\n[a]pprove  [e]dit then approve  [r]eject  [s]kip  [q]uit > ')).trim().toLowerCase();
  if (a === 'q') break;
  if (a === 's' || !a) continue;
  const today = new Date().toISOString().slice(0, 10);
  if (a === 'e') {
    const t = (await rl.question('New text (one line): ')).trim();
    if (!t) continue;
    d.text = t; d.edited_by_reviewer = true; delete d.sentences;
  }
  if (a === 'a' || a === 'e') d.review = { status: 'approved', by, on: today, notes: (await rl.question('Notes (sources checked, optional): ')).trim() || null };
  if (a === 'r') d.review = { status: 'rejected', by, on: today, notes: (await rl.question('Why: ')).trim() || null };
  await fs.writeFile(file, JSON.stringify(d, null, 2) + '\n');
  console.log(`  → ${d.review.status}`);
}
rl.close();
if (!pending) console.log('No drafts awaiting review.');
else console.log('\nApproved descriptions are published on the next pipeline run.');
