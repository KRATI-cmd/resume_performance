import { z } from 'zod';

/** Postgres text columns reject NUL (\u0000); strip it (and surrounding whitespace) before validating. */
const cleanText = (min: number, max: number, minMessage?: string) =>
  z
    .string()
    .transform((s) => s.replace(/\u0000/g, '').trim())
    .pipe(z.string().min(min, minMessage).max(max));

export const analyzeBodySchema = z.object({
  /** Omit to let the API auto-select the best resume for this job. */
  resumeId: z.string().uuid().optional(),
  sourceUrl: cleanText(1, 2048).pipe(z.string().url()),
  rawJdText: cleanText(50, 50_000, 'rawJdText is too short to be a job description'),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const upsertProfileBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  fullName: z.string().trim().min(1).max(200),
  headline: z.string().trim().max(300).optional(),
  baseResume: z.record(z.unknown()).default({}),
});

/** Never store credentials, one-time codes, card data or government-ID style fields. */
const SENSITIVE_KEY = /(^|_)(password|passwd|pwd|otp|cvv|cvc|card|ssn|aadhaar|aadhar|captcha|csrf|token|secret)(_|$)/;

export const normalizeAnswerKey = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);

export const isSensitiveKey = (key: string): boolean => SENSITIVE_KEY.test(key);

const answerItemSchema = z.object({
  key: cleanText(1, 200).transform(normalizeAnswerKey).pipe(z.string().min(1)),
  label: cleanText(1, 300),
  value: cleanText(1, 2000),
});

export const answersBodySchema = z.object({ answers: z.array(answerItemSchema).min(1).max(200) });

const bulletSchema = z.object({
  category: cleanText(1, 80),
  title: cleanText(1, 200),
  bulletText: cleanText(10, 2000),
  tags: z.array(cleanText(1, 60)).max(30).default([]),
});

export const resumeSaveSchema = z.object({
  targetRole: cleanText(2, 120),
  fileName: cleanText(1, 255).nullish(),
  rawText: cleanText(200, 100_000),
  bullets: z.array(bulletSchema).min(1).max(150),
  answers: z.array(answerItemSchema).max(200).default([]),
});

export const resumeRenameSchema = z.object({ targetRole: cleanText(2, 120) });

export const chunksBodySchema = z.object({
  chunks: z
    .array(
      z.object({
        category: cleanText(1, 80),
        title: cleanText(1, 200),
        bulletText: cleanText(10, 2000),
        tags: z.array(cleanText(1, 60)).max(30).default([]),
      }),
    )
    .min(1)
    .max(100),
});
