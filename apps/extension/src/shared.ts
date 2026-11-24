export type Settings = {
  apiUrl: string;
  webUrl: string;
  userId: string | null;
  email: string;
  fullName: string;
};

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: 'http://localhost:4000',
  webUrl: 'http://localhost:5174',
  userId: null,
  email: '',
  fullName: '',
};

export type TailoredBullet = { sourceChunkId: string; originalBullet: string; tailoredBullet: string; rationale: string };

export type Application = {
  id: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  companyName: string | null;
  roleTitle: string | null;
  sourceUrl: string;
  matchScore: number | null;
  missingKeywords: string[];
  tailoredBullets?: TailoredBullet[] | null;
  outreachDraft?: string | null;
  errorMessage: string | null;
};

export type RunState =
  | { phase: 'idle' }
  | { phase: 'processing'; applicationId: string; sourceUrl: string }
  | { phase: 'completed'; application: Application; cached: boolean }
  | { phase: 'failed'; error: string; sourceUrl?: string };

export const STORAGE = { settings: 'settings', run: 'run' } as const;

export type Message =
  | { type: 'analyze'; sourceUrl: string; rawJdText: string }
  | { type: 'connect'; settings: Settings }
  | { type: 'reset' };

export type Reply = { ok: true; settings?: Settings } | { ok: false; error: string };

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(STORAGE.settings);
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE.settings] as Partial<Settings> | undefined) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE.settings]: s });
}

export async function loadRun(): Promise<RunState> {
  const data = await chrome.storage.local.get(STORAGE.run);
  return (data[STORAGE.run] as RunState | undefined) ?? { phase: 'idle' };
}

export async function saveRun(r: RunState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE.run]: r });
}
