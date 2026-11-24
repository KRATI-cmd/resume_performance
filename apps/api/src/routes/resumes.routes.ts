import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { asyncHandler, requireUser } from '../middleware/common';
import { idParamSchema, resumeRenameSchema, resumeSaveSchema } from '../schemas/http.schema';
import { upsertAnswers } from '../services/answers.service';
import { storeChunks } from '../services/chunk.service';
import { answersFromParsed, extractResumeText, groundBullets, parseResumeWithLlm } from '../services/resume.service';

export const resumesRouter = Router();
resumesRouter.use(requireUser);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const MAX_RESUMES = 10;

/** GET /api/v1/resumes */
resumesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.resume.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, targetRole: true, fileName: true, createdAt: true, _count: { select: { chunks: true } } },
    });
    res.json({
      resumes: rows.map(({ _count, ...r }) => ({ ...r, bulletCount: _count.chunks })),
    });
  }),
);

/**
 * POST /api/v1/resumes/parse  (multipart: file? | text?, targetRole)
 * Extracts and parses a resume into a DRAFT for the user to review. Nothing is saved.
 */
resumesRouter.post(
  '/parse',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const targetRole = String(req.body?.targetRole ?? '').trim();
    if (targetRole.length < 2) throw new AppError(400, 'Choose the position this resume is for', 'VALIDATION_ERROR');

    let rawText: string;
    if (req.file) {
      rawText = await extractResumeText(req.file);
    } else if (typeof req.body?.text === 'string' && req.body.text.trim().length >= 200) {
      rawText = req.body.text.replace(/\u0000/g, '').trim();
    } else {
      throw new AppError(400, 'Upload a PDF/DOCX/TXT file, or paste at least 200 characters of resume text', 'VALIDATION_ERROR');
    }

    const parsed = await parseResumeWithLlm(rawText, targetRole);
    const { kept, dropped } = groundBullets(parsed.bullets, rawText);
    if (kept.length === 0) {
      throw new AppError(422, 'No experience bullets could be extracted from this resume.', 'NO_BULLETS');
    }
    res.json({
      draft: {
        targetRole,
        fileName: req.file?.originalname ?? null,
        rawText,
        bullets: kept,
        answers: answersFromParsed(parsed),
        warnings: dropped > 0 ? [`${dropped} extracted bullet(s) were dropped because they could not be verified against your resume text.`] : [],
      },
    });
  }),
);

/** POST /api/v1/resumes — save a reviewed draft. */
resumesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = resumeSaveSchema.parse(req.body);
    const count = await prisma.resume.count({ where: { userId: req.userId } });
    if (count >= MAX_RESUMES) throw new AppError(409, `You can keep up to ${MAX_RESUMES} resumes`, 'LIMIT_REACHED');

    const resume = await prisma.resume.create({
      data: { userId: req.userId, targetRole: body.targetRole, fileName: body.fileName ?? null, rawText: body.rawText },
      select: { id: true, targetRole: true, fileName: true, createdAt: true },
    });
    try {
      const { ids, skipped, tokens } = await storeChunks(req.userId, body.bullets, resume.id);
      const answers = body.answers.length ? await upsertAnswers(req.userId, body.answers) : { saved: 0, refused: 0 };
      res.status(201).json({ resume, created: ids.length, skipped, embeddingTokens: tokens, answersSaved: answers.saved });
    } catch (err) {
      // Don't leave a resume with no bullets behind if embedding failed.
      await prisma.resume.delete({ where: { id: resume.id } }).catch(() => undefined);
      throw err;
    }
  }),
);

resumesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { targetRole } = resumeRenameSchema.parse(req.body);
    const { count } = await prisma.resume.updateMany({ where: { id, userId: req.userId }, data: { targetRole } });
    if (count === 0) throw new AppError(404, 'Resume not found', 'NOT_FOUND');
    res.json({ id, targetRole });
  }),
);

/** DELETE removes the resume and (via FK cascade) its bullets. Past applications keep their results. */
resumesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { count } = await prisma.resume.deleteMany({ where: { id, userId: req.userId } });
    if (count === 0) throw new AppError(404, 'Resume not found', 'NOT_FOUND');
    res.status(204).end();
  }),
);
