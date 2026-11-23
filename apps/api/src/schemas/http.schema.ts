import { z } from 'zod';

export const analyzeBodySchema = z.object({
  sourceUrl: z.string().trim().url().max(2048),
  rawJdText: z.string().trim().min(50, 'rawJdText is too short to be a job description').max(50_000),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const upsertProfileBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  fullName: z.string().trim().min(1).max(200),
  headline: z.string().trim().max(300).optional(),
  baseResume: z.record(z.unknown()).default({}),
});

export const chunksBodySchema = z.object({
  chunks: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(200),
        bulletText: z.string().trim().min(10).max(2000),
        tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
      }),
    )
    .min(1)
    .max(100),
});
