import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, requireUser } from '../middleware/common';
import { chunksBodySchema, upsertProfileBodySchema } from '../schemas/http.schema';
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

/** POST /api/v1/profile/chunks — embed and store experience bullets. */
profileRouter.post(
  '/chunks',
  requireUser,
  asyncHandler(async (req, res) => {
    const { chunks } = chunksBodySchema.parse(req.body);
    const { ids, tokens } = await storeChunks(req.userId, chunks);
    res.status(201).json({ created: ids.length, ids, embeddingTokens: tokens });
  }),
);
