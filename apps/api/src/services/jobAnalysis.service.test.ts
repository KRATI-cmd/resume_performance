import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { llmOutputSchema, type LlmOutput } from '../schemas/llm.schema';
import type { RetrievedChunk } from './chunk.service';

// Dummy values so env validation passes when no .env is present (CI).
process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
process.env.LLM_API_KEY ??= 'test';

const chunks: RetrievedChunk[] = [
  { id: 'c1', category: 'work', title: 'X', bulletText: 'Cut latency by 40% using Redis', tags: [], similarity: 0.9 },
  { id: 'c2', category: 'work', title: 'Y', bulletText: 'Processed 2,000 jobs daily', tags: [], similarity: 0.8 },
];

const base: LlmOutput = {
  companyName: 'Acme',
  roleTitle: 'Engineer',
  matchScore: 70,
  missingKeywords: ['Kubernetes'],
  tailoredBullets: [
    { sourceChunkId: 'c1', originalBullet: 'model rewrote this', tailoredBullet: 'Reduced latency by 40% with Redis caching', rationale: 'r' },
  ],
  outreachDraft: 'Hello, I cut latency by 40%.',
};

describe('enforceGrounding', async () => {
  const { enforceGrounding } = await import('./jobAnalysis.service');

  it('accepts grounded output and restores the stored original bullet', () => {
    const out = enforceGrounding(base, chunks);
    assert.equal(out.tailoredBullets[0]?.originalBullet, 'Cut latency by 40% using Redis');
  });

  it('rejects an unknown sourceChunkId', () => {
    const bad = { ...base, tailoredBullets: [{ ...base.tailoredBullets[0]!, sourceChunkId: 'nope' }] };
    assert.throws(() => enforceGrounding(bad, chunks), /unknown sourceChunkId/);
  });

  it('rejects invented metrics in a bullet', () => {
    const bad = { ...base, tailoredBullets: [{ ...base.tailoredBullets[0]!, tailoredBullet: 'Cut latency by 90%' }] };
    assert.throws(() => enforceGrounding(bad, chunks), /not present in the source bullet/);
  });

  it('rejects invented numbers in the outreach draft', () => {
    assert.throws(() => enforceGrounding({ ...base, outreachDraft: 'I scaled to 10 million users' }, chunks), /outreachDraft/);
  });
});

describe('llmOutputSchema', () => {
  it('rounds matchScore and rejects out-of-range values', () => {
    assert.equal(llmOutputSchema.parse({ ...base, matchScore: 72.6 }).matchScore, 73);
    assert.throws(() => llmOutputSchema.parse({ ...base, matchScore: 130 }));
  });

  it('requires at least one tailored bullet', () => {
    assert.throws(() => llmOutputSchema.parse({ ...base, tailoredBullets: [] }));
  });
});
