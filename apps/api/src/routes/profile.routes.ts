import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, requireUser } from '../middleware/common';
import { AppError } from '../lib/errors';
import {
  answersBodySchema,
  chunksBodySchema,
  idParamSchema,
  upsertProfileBodySchema,
} from '../schemas/http.schema';
import { upsertAnswers } from '../services/answers.service';
import { storeChunks } from '../services/chunk.service';

export const profileRouter = Router();

/** POST /api/v1/profile — create or update the profile for an email; returns the id used as `x-user-id`. */
profileRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { email, fullName, headline, baseResume } = upsertProfileBodySchema.parse(req.body);
    const profile = await prisma.userProfile.upsert({
      where: { email },
      create: { email, fullName, headline, baseResume: baseResume as Prisma.InputJsonValue },
      update: { fullName, headline, baseResume: baseResume as Prisma.InputJsonValue },
    });
    res.status(200).json({ profile });
  }),
);

/** GET /api/v1/profile/answers — saved autofill answers. */
profileRouter.get(
  '/answers',
  requireUser,
  asyncHandler(async (req, res) => {
    const answers = await prisma.formAnswer.findMany({ where: { userId: req.userId }, orderBy: { key: 'asc' } });
    res.json({ answers });
  }),
);

/** PUT /api/v1/profile/answers — upsert by key; sensitive keys (password, otp, card...) are refused. */
profileRouter.put(
  '/answers',
  requireUser,
  asyncHandler(async (req, res) => {
    const { answers } = answersBodySchema.parse(req.body);
    res.json(await upsertAnswers(req.userId, answers));
  }),
);

profileRouter.delete(
  '/answers/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { count } = await prisma.formAnswer.deleteMany({ where: { id, userId: req.userId } });
    if (count === 0) throw new AppError(404, 'Answer not found', 'NOT_FOUND');
    res.status(204).end();
  }),
);

/** POST /api/v1/profile/chunks — embed and store experience bullets. */
profileRouter.post(
  '/chunks',
  requireUser,
  asyncHandler(async (req, res) => {
    const { chunks } = chunksBodySchema.parse(req.body);
    const { ids, tokens, skipped } = await storeChunks(req.userId, chunks);
    res.status(ids.length > 0 ? 201 : 200).json({ created: ids.length, skipped, ids, embeddingTokens: tokens });
  }),
);
