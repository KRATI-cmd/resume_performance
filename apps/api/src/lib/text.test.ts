import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeJdHash, normalizeJd, toVectorLiteral } from './text';

describe('jd hashing', () => {
  it('normalizes case and whitespace', () => {
    assert.equal(normalizeJd('  Hello \n\t WORLD  '), 'hello world');
  });

  it('produces identical hashes for formatting-only differences', () => {
    assert.equal(computeJdHash('Backend   Engineer\r\nNode.js'), computeJdHash(' backend engineer node.js '));
  });

  it('produces different hashes for different content', () => {
    assert.notEqual(computeJdHash('backend engineer'), computeJdHash('frontend engineer'));
  });

  it('returns a 64-char hex sha256', () => {
    assert.match(computeJdHash('x'), /^[0-9a-f]{64}$/);
  });
});

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    assert.equal(toVectorLiteral([0.1, 0.2, -3]), '[0.1,0.2,-3]');
  });
});
