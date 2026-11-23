import { z } from 'zod';

export const tailoredBulletSchema = z.object({
  sourceChunkId: z.string().min(1),
  originalBullet: z.string().min(1),
  tailoredBullet: z.string().min(1).max(600),
  rationale: z.string().min(1).max(600),
});

export const llmOutputSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().min(1).max(200),
  matchScore: z
    .number()
    .min(0)
    .max(100)
    .transform((n) => Math.round(n)),
  missingKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
  tailoredBullets: z.array(tailoredBulletSchema).min(1).max(6),
  outreachDraft: z.string().trim().min(1).max(2500),
});

export type LlmOutput = z.infer<typeof llmOutputSchema>;
export type TailoredBullet = z.infer<typeof tailoredBulletSchema>;
