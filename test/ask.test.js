import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/index.js';
import { ask, ASK_LIMITS } from '../src/worker/ask.js';
import { recordFor } from '../src/worker/records.js';
import { makeEnv, fixtureJson } from './helpers.js';
import { decodeCatalog, epochMs } from '../public/js/lib/catalog.js';

const SITE = 'https://orbitry.test';
const req = (body, headers = {}) => new Request(SITE + '/api/ask', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
const iss = decodeCatalog(fixtureJson('catalog.json')).find((o) => o.norad === 25544);
const now = epochMs(iss.epoch) + 3600e3;

// Stands in for the Anthropic client; records what it was sent.
function fakeClient(output, stop = 'end_turn') {
  const calls = [];
  return { calls, beta: { messages: { parse: async (params) => { calls.push(params); return { stop_reason: stop, parsed_output: output, model: 'test-model' }; } } } };
}

test('switched off without an API key', async () => {
  const env = makeEnv();
  assert.deepEqual((await (await worker.fetch(new Request(SITE + '/api/ask'), env)).json()).enabled, false);
  const r = await worker.fetch(req({ id: 'norad-25544', question: 'How high is it?' }), env);
  assert.equal(r.status, 503);
});

test('records hold the page facts plus live values', async () => {
  const env = makeEnv();
  const { record } = await recordFor(env, 'norad-25544', now);
  assert.equal(record.operator, 'NASA JSC');
  assert.ok(record.now.altitude_km > 380 && record.now.altitude_km < 460);
  assert.equal((await recordFor(env, 'moon-apollo-11')).record.body, 'Moon');
  const v = await recordFor(env, 'probe-voyager-1', Date.parse(fixtureJson('solar-system.json').window.start) + 10 * 864e5);
  assert.ok(v.record.now.one_way_light_time_hours > 20);
  await assert.rejects(recordFor(env, 'norad-1'), /not in the current catalog/);
  await assert.rejects(recordFor(env, '../etc'), /Unknown object id/);
});

test('answers keep only sentences whose cited facts exist, and show those facts', async () => {
  const env = makeEnv();
  const client = fakeClient({
    answerable: true,
    sentences: [
      { text: 'It is operated by NASA JSC.', supported_by: ['operator'] },
      { text: 'It was built on the Moon.', supported_by: ['made_up_field'] }
    ],
    not_covered: ''
  });
  const r = await ask(req({ id: 'norad-25544', question: 'Who runs it?' }), env, { client, now });
  const a = await r.json();
  assert.equal(a.answerable, true);
  assert.equal(a.text, 'It is operated by NASA JSC.');
  assert.deepEqual(a.sentences[0].facts, [{ field: 'operator', value: 'NASA JSC' }]);
  // The record and the question reach Claude, with the question marked as data.
  const sent = client.calls[0];
  assert.match(sent.messages[0].content, /"operator": "NASA JSC"/);
  assert.match(sent.messages[0].content, /<question>Who runs it\?<\/question>/);
  assert.equal(sent.fallbacks, 'default');
  // A repeat is served from the cache without calling Claude again.
  const again = await (await ask(req({ id: 'norad-25544', question: '  who RUNS it? ' }), env, { client, now })).json();
  assert.equal(again.cached, true);
  assert.equal(client.calls.length, 1);
});

test('unanswerable questions say so, and refusals are handled', async () => {
  const env = makeEnv();
  const none = fakeClient({ answerable: false, sentences: [{ text: "The record doesn't say what it smells like.", supported_by: [] }], not_covered: 'smell' });
  const a = await (await ask(req({ id: 'moon-apollo-11', question: 'What does it smell like?' }), env, { client: none, now })).json();
  assert.equal(a.answerable, false);
  assert.match(a.text, /doesn't say/);
  assert.equal(a.not_covered, 'smell');
  const refused = await (await ask(req({ id: 'moon-apollo-11', question: 'Something odd' }), env, { client: fakeClient(null, 'refusal'), now })).json();
  assert.equal(refused.answerable, false);
});

test('live answers are not cached', async () => {
  const env = makeEnv();
  const client = fakeClient({ answerable: true, sentences: [{ text: 'It is about 420 km up.', supported_by: ['now.altitude_km'] }], not_covered: '' });
  await ask(req({ id: 'norad-25544', question: 'How high is it?' }), env, { client, now });
  await ask(req({ id: 'norad-25544', question: 'How high is it?' }), env, { client, now });
  assert.equal(client.calls.length, 2);
});

test('questions are validated and rate limited', async () => {
  const env = makeEnv();
  const client = fakeClient({ answerable: true, sentences: [{ text: 'NASA JSC.', supported_by: ['operator'] }], not_covered: '' });
  await assert.rejects(ask(req({ id: 'norad-25544', question: 'x'.repeat(ASK_LIMITS.questionChars + 1) }), env, { client }), /under 300/);
  await assert.rejects(ask(req({ id: 'norad-25544', question: '' }), env, { client }), /Type a question/);
  for (let i = 0; i < ASK_LIMITS.anonymous; i++) await ask(req({ id: 'norad-25544', question: `Question number ${i}` }), env, { client, now });
  await assert.rejects(ask(req({ id: 'norad-25544', question: 'One more?' }), env, { client, now }), /daily limit/);
});
