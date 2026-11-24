// E2E for multi-resume upload + auto-selection against a RUNNING api + worker.  Usage: npm run test:e2e:resumes
import assert from 'node:assert/strict';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const json = { 'content-type': 'application/json' };
const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log('ok', m);

const backendResume = `Asha Verma
asha.verma@example.com | +91 98765 43210
Backend Developer, Node.js, TypeScript, PostgreSQL, Kafka, Redis, microservices, REST APIs.
- Built REST APIs in Node.js and TypeScript serving 120 tenants with PostgreSQL
- Reduced backend API latency by 40 percent using Redis caching and index tuning
- Designed a Kafka consumer pipeline for event driven microservices with retries`;

const dataResume = `Asha Verma
asha.verma@example.com | +91 98765 43210
Data Scientist, Python, pandas, scikit-learn, machine learning, statistics, forecasting models.
- Trained gradient boosting models in Python and pandas to forecast weekly demand
- Built feature engineering notebooks with scikit-learn for churn prediction models
- Presented statistics dashboards on model accuracy to business stakeholders`;

const email = `resume-e2e-${Date.now()}@example.com`;
const prof = await call('/api/v1/profile', { method: 'POST', headers: json, body: JSON.stringify({ email, fullName: 'Asha Verma' }) });
const auth = { ...json, 'x-user-id': prof.body.profile.id };
const authOnly = { 'x-user-id': prof.body.profile.id };

async function parse(text, role, { asFile = true, name = 'resume.txt' } = {}) {
  const fd = new FormData();
  fd.set('targetRole', role);
  if (asFile) fd.set('file', new Blob([text]), name); else fd.set('text', text);
  return call('/api/v1/resumes/parse', { method: 'POST', headers: authOnly, body: fd });
}

// --- validation ---
assert.equal((await parse(backendResume, '')).status, 400);
assert.equal((await parse(backendResume, 'SDE', { name: 'resume.exe' })).status, 400);
const big = await parse('x'.repeat(5.5 * 1024 * 1024), 'SDE');
assert.equal(big.status, 413);
assert.equal((await call('/api/v1/resumes', { headers: json })).status, 401);
ok('upload validation (role required, bad type, >5MB, auth)');

// --- parse -> review -> save, two resumes ---
const a = await parse(backendResume, 'SDE-2 Backend');
assert.equal(a.status, 200, JSON.stringify(a.body));
assert.equal(a.body.draft.bullets.length, 3);
assert.equal(a.body.draft.answers.find((x) => x.key === 'email')?.value, 'asha.verma@example.com');
ok('parse file -> draft with 3 bullets + contact answers (nothing saved yet)');
assert.equal((await call('/api/v1/resumes', { headers: auth })).body.resumes.length, 0);

const b = await parse(dataResume, 'Data Scientist', { asFile: false });
assert.equal(b.status, 200, JSON.stringify(b.body));
ok('parse pasted text');

const saveA = await call('/api/v1/resumes', { method: 'POST', headers: auth, body: JSON.stringify(a.body.draft) });
const saveB = await call('/api/v1/resumes', { method: 'POST', headers: auth, body: JSON.stringify(b.body.draft) });
assert.equal(saveA.status, 201); assert.equal(saveB.status, 201);
const idA = saveA.body.resume.id, idB = saveB.body.resume.id;
const list = await call('/api/v1/resumes', { headers: auth });
assert.equal(list.body.resumes.length, 2);
assert.ok(list.body.resumes.every((r) => r.bulletCount === 3));
ok('saved 2 resumes, 3 bullets each');

const answers = await call('/api/v1/profile/answers', { headers: auth });
assert.ok(answers.body.answers.some((x) => x.key === 'first_name' && x.value === 'Asha'));
ok('contact details saved as autofill answers');

// --- auto-selection ---
async function analyze(jd, resumeId) {
  const body = { sourceUrl: 'https://example.com/job', rawJdText: jd, ...(resumeId ? { resumeId } : {}) };
  const r = await call('/api/v1/jobs/analyze', { method: 'POST', headers: auth, body: JSON.stringify(body) });
  if (r.status === 200) return r;
  for (let i = 0; i < 60; i++) {
    const g = await call(`/api/v1/jobs/${r.body.application.id}`, { headers: auth });
    if (g.body.application.status !== 'PROCESSING') return { status: r.status, body: { cached: false, application: g.body.application } };
    await wait(500);
  }
  throw new Error('analysis timeout');
}

const backendJd = 'SDE-2 Backend role. Build Node.js and TypeScript REST APIs on PostgreSQL with Redis caching, Kafka event driven microservices and strong backend engineering.';
const dataJd = 'Data Scientist role. Train machine learning models in Python with pandas and scikit-learn, statistics, forecasting and churn prediction.';

const r1 = await analyze(backendJd);
assert.equal(r1.body.application.status, 'COMPLETED', r1.body.application.errorMessage);
assert.equal(r1.body.application.resumeId, idA);
assert.equal(r1.body.application.resumeAutoSelected, true);
ok('auto-selected the Backend resume for a backend job');

const r2 = await analyze(dataJd);
assert.equal(r2.body.application.status, 'COMPLETED', r2.body.application.errorMessage);
assert.equal(r2.body.application.resumeId, idB);
ok('auto-selected the Data Scientist resume for a data job');

// --- manual override, then cache behaviour ---
const r3 = await analyze(backendJd, idB);
assert.equal(r3.status, 202);
assert.equal(r3.body.application.resumeId, idB);
assert.equal(r3.body.application.resumeAutoSelected, false);
ok('explicit resume overrides auto-selection (re-run, not cached)');

const r4 = await call('/api/v1/jobs/analyze', { method: 'POST', headers: auth, body: JSON.stringify({ sourceUrl: 'https://example.com/job', rawJdText: backendJd, resumeId: idB }) });
assert.equal(r4.status, 200); assert.equal(r4.body.cached, true);
ok('same job + same resume -> cached');

const foreign = await call('/api/v1/jobs/analyze', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ sourceUrl: 'https://example.com/job', rawJdText: backendJd, resumeId: '00000000-0000-4000-8000-000000000000' }),
});
assert.equal(foreign.status, 404);
ok('unknown/foreign resumeId -> 404');

// --- rename + delete ---
assert.equal((await call(`/api/v1/resumes/${idB}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ targetRole: 'ML Engineer' }) })).status, 200);
assert.equal((await call(`/api/v1/resumes/${idB}`, { method: 'DELETE', headers: authOnly })).status, 204);
assert.equal((await call('/api/v1/resumes', { headers: auth })).body.resumes.length, 1);
const kept = await call(`/api/v1/jobs/${r2.body.application.id}`, { headers: auth });
assert.equal(kept.body.application.status, 'COMPLETED');
ok('rename + delete resume; past application results are kept');

console.log('\nALL PASSED');
