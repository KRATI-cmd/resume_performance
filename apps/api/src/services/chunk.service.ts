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

export async function storeChunks(
  userId: string,
  chunks: ChunkInput[],
): Promise<{ ids: string[]; tokens: number }> {
  const { vectors, tokens } = await embedTexts(
    chunks.map((c) => `${c.title}\n${c.bulletText}\n${c.tags.join(', ')}`),
  );

  const ids = chunks.map(() => randomUUID());

  // `embedding` is an Unsupported() column, so Prisma Client cannot write it: use raw SQL.
  await prisma.$transaction(
    chunks.map((chunk, i) =>
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "ExperienceChunk" ("id", "userId", "category", "title", "bulletText", "tags", "embedding")
        VALUES (
          ${ids[i]},
          ${userId},
          ${chunk.category},
          ${chunk.title},
          ${chunk.bulletText},
          ${chunk.tags}::text[],
          ${toVectorLiteral(vectors[i] as number[])}::vector
        )
      `),
    ),
  );

  return { ids, tokens };
}

/** Cosine-similarity top-K retrieval scoped to a single user. */
export async function findRelevantChunks(
  userId: string,
  queryVector: number[],
  limit: number = TOP_K_CHUNKS,
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
    ORDER BY "embedding" <=> ${literal}::vector
    LIMIT ${limit}
  `);

  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}
