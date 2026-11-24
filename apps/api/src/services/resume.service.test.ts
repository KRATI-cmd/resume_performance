import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
process.env.LLM_API_KEY ??= 'test';

const resumeText = `Jane Doe
Backend Developer with 3 years of experience.
- Reduced API latency by 40% using Redis caching in Node.js services
- Built a Kafka pipeline that processes 10,000 images a day`;

describe('groundBullets', async () => {
  const { groundBullets } = await import('./resume.service');
  const b = (bulletText: string) => ({ category: 'work', title: 'Acme', bulletText, tags: [] as string[] });

  it('keeps bullets that are verbatim in the resume', () => {
    const { kept, dropped } = groundBullets([b('Reduced API latency by 40% using Redis caching in Node.js services')], resumeText);
    assert.equal(kept.length, 1);
    assert.equal(dropped, 0);
  });

  it('drops bullets containing numbers not in the resume', () => {
    const { kept, dropped } = groundBullets([b('Reduced API latency by 90% using Redis caching in Node.js services')], resumeText);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 1);
  });

  it('drops bullets whose wording is mostly not in the resume', () => {
    const { kept } = groundBullets([b('Led a team of rockstar ninjas to deliver synergistic blockchain outcomes')], resumeText);
    assert.equal(kept.length, 0);
  });
});

describe('roleMatch', async () => {
  const { roleMatch } = await import('./resume.service');

  it('scores target-role keywords found in the job text', () => {
    assert.ok(roleMatch('SDE-2 Backend', 'We are hiring an SDE-2 for our backend platform team') > 0.9);
    assert.ok(roleMatch('Data Scientist', 'Backend engineer for payments, Node.js') < 0.5);
  });

  it('returns 0 for an empty role', () => {
    assert.equal(roleMatch('', 'anything'), 0);
  });
});

describe('answersFromParsed', async () => {
  const { answersFromParsed } = await import('./resume.service');

  it('derives name parts and keeps only valid contact details', () => {
    const answers = answersFromParsed({
      fullName: 'Jane Q Doe', email: 'jane@example.com', phone: '+91 97601 57772', location: null,
      totalExperienceYears: 2.5, bullets: [],
    } as never);
    const map = Object.fromEntries(answers.map((a) => [a.key, a.value]));
    assert.equal(map.first_name, 'Jane');
    assert.equal(map.last_name, 'Q Doe');
    assert.equal(map.email, 'jane@example.com');
    assert.equal(map.total_experience, '2.5');
    assert.equal('city' in map, false);
  });

  it('ignores a malformed email and a too-short phone', () => {
    const map = Object.fromEntries(
      answersFromParsed({ fullName: 'A B', email: 'not-an-email', phone: '123', bullets: [] } as never).map((a) => [a.key, a.value]),
    );
    assert.equal('email' in map, false);
    assert.equal('phone' in map, false);
  });
});
