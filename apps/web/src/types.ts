export type ApplicationStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type TailoredBullet = {
  sourceChunkId: string;
  originalBullet: string;
  tailoredBullet: string;
  rationale: string;
};

export type Application = {
  id: string;
  userId: string;
  jdHash: string;
  companyName: string | null;
  roleTitle: string | null;
  sourceUrl: string;
  rawJdText?: string;
  status: ApplicationStatus;
  matchScore: number | null;
  missingKeywords: string[];
  tailoredBullets?: TailoredBullet[] | null;
  outreachDraft?: string | null;
  resumeId?: string | null;
  resumeAutoSelected?: boolean;
  tokensUsed: number | null;
  processingTimeMs: number | null;
  errorMessage: string | null;
  createdAt: string;
};

export type Stage = 'embedding' | 'retrieval' | 'generation' | 'saving';

export type JobEvent = {
  applicationId: string;
  status: ApplicationStatus;
  stage?: Stage;
  application?: Application;
  error?: string;
};

export type Profile = { id: string; email: string; fullName: string; headline: string | null };

export type Resume = { id: string; targetRole: string; fileName: string | null; createdAt: string; bulletCount: number };

export type Answer = { id?: string; key: string; label: string; value: string };

export type DraftBullet = { category: string; title: string; bulletText: string; tags: string[] };

export type ResumeDraft = {
  targetRole: string;
  fileName: string | null;
  rawText: string;
  bullets: DraftBullet[];
  answers: Answer[];
  warnings: string[];
};

export type ChunkInput = { category: string; title: string; bulletText: string; tags: string[] };
