import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toVectorLiteral } from '../lib/text';
import { embedTexts } from './embedding.service';

export type ChunkInput = {
  category: string;
  title: string;
  bulletText: string;
  tags: string[];
};

export type RetrievedChunk = {
  id: string;
  category: string;
  title: string;
  bulletText: string;
  tags: string[];
  similarity: number;
};

export const TOP_K_CHUNKS = 6;

const dedupeKey = (c: { title: string; bulletText: string }) =>
  `${c.title}\u0001${c.bulletText}`.toLowerCase().replace(/\s+/g, ' ');

export async function storeChunks(
  userId: string,
  incoming: ChunkInput[],
  resumeId: string | null = null,
): Promise<{ ids: string[]; tokens: number; skipped: number }> {
  // Skip bullets already saved in this resume (and repeats inside this request) so that
  // re-submitting doesn't create duplicates that crowd out the top-6 retrieval.
  const existing = await prisma.experienceChunk.findMany({
    where: { userId, resumeId, bulletText: { in: incoming.map((c) => c.bulletText) } },
    select: { title: true, bulletText: true },
  });
  const seen = new Set(existing.map(dedupeKey));
  const chunks = incoming.filter((c) => {
    const key = dedupeKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const skipped = incoming.length - chunks.length;
  if (chunks.length === 0) return { ids: [], tokens: 0, skipped };

  const { vectors, tokens } = await embedTexts(
    chunks.map((c) => `${c.title}\n${c.bulletText}\n${c.tags.join(', ')}`),
  );

  const ids = chunks.map(() => randomUUID());

  // `embedding` is an Unsupported() column, so Prisma Client cannot write it: use raw SQL.
  await prisma.$transaction(
    chunks.map((chunk, i) =>
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "ExperienceChunk" ("id", "userId", "resumeId", "category", "title", "bulletText", "tags", "embedding")
        VALUES (
          ${ids[i]},
          ${userId},
          ${resumeId}::text,
          ${chunk.category},
          ${chunk.title},
          ${chunk.bulletText},
          ${chunk.tags}::text[],
          ${toVectorLiteral(vectors[i] as number[])}::vector
        )
      `),
    ),
  );

  return { ids, tokens, skipped };
}

/** Cosine-similarity top-K retrieval scoped to a single user. */
export async function findRelevantChunks(
  userId: string,
  queryVector: number[],
  limit: number = TOP_K_CHUNKS,
  resumeId: string | null = null,
): Promise<RetrievedChunk[]> {
  const literal = toVectorLiteral(queryVector);
  const rows = await prisma.$queryRaw<
    Array<Omit<RetrievedChunk, 'similarity'> & { similarity: number | string }>
  >(Prisma.sql`
    SELECT
      "id",
      "category",
      "title",
      "bulletText",
      "tags",
      1 - ("embedding" <=> ${literal}::vector) AS "similarity"
    FROM "ExperienceChunk"
    WHERE "userId" = ${userId}
      ${resumeId ? Prisma.sql`AND "resumeId" = ${resumeId}` : Prisma.empty}
    ORDER BY "embedding" <=> ${literal}::vector
    LIMIT ${limit}
  `);

  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}
