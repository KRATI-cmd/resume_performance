// End-to-end smoke test against a RUNNING api + worker.  Usage: npm run test:e2e
import assert from 'node:assert/strict';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const json = { 'content-type': 'application/json' };
const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
};

const email = `e2e-${Date.now()}@example.com`;
const profile = await call('/api/v1/profile', {
  method: 'POST', headers: json, body: JSON.stringify({ email, fullName: 'E2E User' }),
});
assert.equal(profile.status, 200);
const auth = { ...json, 'x-user-id': profile.body.profile.id };
console.log('ok profile');

assert.equal((await call('/api/v1/jobs/analyze', { method: 'POST', headers: json, body: '{}' })).status, 401);
assert.equal((await call('/api/v1/jobs/analyze', { method: 'POST', headers: auth, body: '{"sourceUrl":"x"}' })).status, 400);
console.log('ok auth + validation');

const chunks = await call('/api/v1/profile/chunks', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ chunks: [{ category: 'work', title: 'SWE', bulletText: 'Reduced API latency by 40% using Redis caching', tags: ['redis'] }] }),
});
assert.equal(chunks.status, 201);
assert.equal(chunks.body.created, 1);
console.log('ok chunks');

const jd = `Backend engineer needed. Node.js, Redis, Postgres. Unique ${Date.now()} ${'x'.repeat(30)}`;
const payload = JSON.stringify({ sourceUrl: 'https://example.com/job', rawJdText: jd });
const reformatted = JSON.stringify({ sourceUrl: 'https://example.com/job', rawJdText: `  ${jd.toUpperCase().replace(/ /g, '   ')}\n` });
const first = await call('/api/v1/jobs/analyze', { method: 'POST', headers: auth, body: payload });
assert.equal(first.status, 202);
assert.equal(first.body.cached, false);
const id = first.body.application.id;

let done;
for (let i = 0; i < 60; i++) {
  const r = await call(`/api/v1/jobs/${id}`, { headers: auth });
  if (r.body.application.status !== 'PROCESSING') { done = r.body.application; break; }
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(done, 'job did not finish in 60s');
assert.equal(done.status, 'COMPLETED', done.errorMessage);
assert.ok(done.tokensUsed > 0 && done.processingTimeMs >= 0);
console.log('ok analyze ->', done.status);

const second = await call('/api/v1/jobs/analyze', { method: 'POST', headers: auth, body: reformatted });
assert.equal(second.status, 200);
assert.equal(second.body.cached, true);
assert.equal(second.body.application.id, id);
console.log('ok idempotent cache');

const sse = await fetch(`${BASE}/api/v1/jobs/${id}/stream?userId=${profile.body.profile.id}`);
assert.equal(sse.headers.get('content-type')?.startsWith('text/event-stream'), true);
assert.match(await sse.text(), /"status":"COMPLETED"/);
console.log('ok sse');
console.log('\nALL PASSED');
