import { createHash } from 'node:crypto';

/**
 * Canonical form of a job description used for hashing: Unicode-normalised,
 * case-folded, with all whitespace runs collapsed. Two JDs that differ only in
 * formatting therefore produce the same hash.
 */
export function normalizeJd(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function computeJdHash(raw: string): string {
  return createHash('sha256').update(normalizeJd(raw)).digest('hex');
}

/** pgvector text literal, e.g. "[0.1,0.2]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
