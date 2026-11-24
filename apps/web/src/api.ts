import type { Answer, Application, ChunkInput, JobEvent, Profile, Resume, ResumeDraft } from './types';

const USER_KEY = 'applyflow.userId';

export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(USER_KEY);
    } catch {
      return null;
    }
  },
  set(id: string): void {
    try {
      localStorage.setItem(USER_KEY, id);
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, userId = session.get()): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  // Let the browser set the multipart boundary for FormData.
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (userId) headers.set('x-user-id', userId);

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the API. Is it running?');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`, body?.error?.code);
  }
  return { status: res.status, data: body as T };
}

export const api = {
  async saveProfile(input: { email: string; fullName: string; headline?: string }): Promise<Profile> {
    const { data } = await request<{ profile: Profile }>('/profile', { method: 'POST', body: JSON.stringify(input) }, null);
    return data.profile;
  },

  async addChunks(chunks: ChunkInput[]): Promise<{ created: number; skipped: number }> {
    const { data } = await request<{ created: number; skipped: number }>('/profile/chunks', {
      method: 'POST',
      body: JSON.stringify({ chunks }),
    });
    return data;
  },

  async analyze(sourceUrl: string, rawJdText: string, resumeId?: string): Promise<{ cached: boolean; application: Application }> {
    const { data } = await request<{ cached: boolean; application: Application }>('/jobs/analyze', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl, rawJdText, ...(resumeId ? { resumeId } : {}) }),
    });
    return data;
  },

  async listResumes(): Promise<Resume[]> {
    const { data } = await request<{ resumes: Resume[] }>('/resumes');
    return data.resumes;
  },

  async parseResume(input: { targetRole: string; file?: File; text?: string }): Promise<ResumeDraft> {
    const fd = new FormData();
    fd.set('targetRole', input.targetRole);
    if (input.file) fd.set('file', input.file);
    else if (input.text) fd.set('text', input.text);
    const { data } = await request<{ draft: ResumeDraft }>('/resumes/parse', { method: 'POST', body: fd });
    return data.draft;
  },

  async saveResume(draft: ResumeDraft): Promise<{ created: number; skipped: number }> {
    const { data } = await request<{ created: number; skipped: number }>('/resumes', {
      method: 'POST',
      body: JSON.stringify({
        targetRole: draft.targetRole,
        fileName: draft.fileName,
        rawText: draft.rawText,
        bullets: draft.bullets,
        answers: draft.answers.map(({ key, label, value }) => ({ key, label, value })),
      }),
    });
    return data;
  },

  async renameResume(id: string, targetRole: string): Promise<void> {
    await request(`/resumes/${id}`, { method: 'PATCH', body: JSON.stringify({ targetRole }) });
  },

  async deleteResume(id: string): Promise<void> {
    await request(`/resumes/${id}`, { method: 'DELETE' });
  },

  async listAnswers(): Promise<Answer[]> {
    const { data } = await request<{ answers: Answer[] }>('/profile/answers');
    return data.answers;
  },

  async saveAnswers(answers: Answer[]): Promise<void> {
    await request('/profile/answers', {
      method: 'PUT',
      body: JSON.stringify({ answers: answers.map(({ key, label, value }) => ({ key, label, value })) }),
    });
  },

  async deleteAnswer(id: string): Promise<void> {
    await request(`/profile/answers/${id}`, { method: 'DELETE' });
  },

  async getJob(id: string): Promise<Application> {
    const { data } = await request<{ application: Application }>(`/jobs/${id}`);
    return data.application;
  },

  async listJobs(): Promise<Application[]> {
    const { data } = await request<{ applications: Application[] }>('/jobs');
    return data.applications;
  },
};

/**
 * Subscribes to live status updates. EventSource cannot send headers, so the user id
 * goes in the query string. Returns an unsubscribe function.
 */
export function streamJob(id: string, userId: string, onEvent: (e: JobEvent) => void): () => void {
  const es = new EventSource(`/api/v1/jobs/${id}/stream?userId=${encodeURIComponent(userId)}`);
  let finished = false;

  const finish = () => {
    finished = true;
    es.close();
  };

  es.addEventListener('status', (msg) => {
    const event = JSON.parse((msg as MessageEvent<string>).data) as JobEvent;
    onEvent(event);
    if (event.status !== 'PROCESSING') finish();
  });

  // The server closes the stream after a terminal event; only treat it as an error if we
  // never saw one. Fall back to a single fetch so the UI can't hang on a dropped connection.
  es.onerror = () => {
    if (finished) return;
    api
      .getJob(id)
      .then((app) => {
        if (app.status !== 'PROCESSING') {
          onEvent({ applicationId: id, status: app.status, application: app, error: app.errorMessage ?? undefined });
          finish();
        }
      })
      .catch(() => undefined);
  };

  return finish;
}
