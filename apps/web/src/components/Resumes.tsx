import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Resume, ResumeDraft } from '../types';

const ROLE_SUGGESTIONS = ['SDE-1 Backend', 'SDE-2 Backend', 'Senior Backend Engineer', 'Full Stack Developer', 'Node.js Developer', 'Data Engineer'];

type Props = { onboarding: boolean; onChanged: () => void };

export function Resumes({ onboarding, onChanged }: Props) {
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(onboarding);

  const load = () => api.listResumes().then(setResumes).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function remove(r: Resume) {
    if (!window.confirm(`Delete "${r.targetRole}" and its ${r.bulletCount} bullets? Past analyses are kept.`)) return;
    try {
      await api.deleteResume(r.id);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function rename(r: Resume) {
    const next = window.prompt('Target position for this resume', r.targetRole)?.trim();
    if (!next || next === r.targetRole) return;
    try {
      await api.renameResume(r.id, next);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    }
  }

  return (
    <div className="space-y-5">
      {onboarding && (
        <div className="card border-brand-100 bg-brand-50 text-sm text-brand-700">
          <p className="font-semibold">Welcome! Let's set up your first resume.</p>
          <p className="mt-1">Upload it and tell us which position it's for. You can add more resumes later, one per role, and ApplyFlow will pick the best one for each job.</p>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {resumes && resumes.length > 0 && (
        <ul className="space-y-2">
          {resumes.map((r) => (
            <li key={r.id} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.targetRole}</p>
                <p className="truncate text-xs text-slate-500">
                  {r.bulletCount} bullets · {r.fileName ?? 'pasted text'} · {new Date(r.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn-ghost" onClick={() => rename(r)}>Rename</button>
                <button className="btn-ghost text-red-700" onClick={() => remove(r)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddResume
          onCancel={resumes && resumes.length > 0 ? () => setAdding(false) : undefined}
          onSaved={async () => {
            setAdding(false);
            await load();
            onChanged();
          }}
        />
      ) : (
        <button className="btn" onClick={() => setAdding(true)} disabled={(resumes?.length ?? 0) >= 10}>
          + Add another resume
        </button>
      )}
    </div>
  );
}

function AddResume({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const [targetRole, setTargetRole] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [useBullet, setUseBullet] = useState<boolean[]>([]);
  const [useAnswer, setUseAnswer] = useState<boolean[]>([]);

  async function parse(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file && text.trim().length < 200) return setError('Upload a file, or paste at least 200 characters of resume text.');
    setBusy(true);
    try {
      const d = await api.parseResume({ targetRole: targetRole.trim(), file: file ?? undefined, text: text.trim() || undefined });
      setDraft(d);
      setUseBullet(d.bullets.map(() => true));
      setUseAnswer(d.answers.map(() => true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the resume');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const bullets = draft.bullets.filter((_, i) => useBullet[i]);
    if (bullets.length === 0) return setError('Keep at least one bullet.');
    setBusy(true);
    setError(null);
    try {
      await api.saveResume({ ...draft, bullets, answers: draft.answers.filter((_, i) => useAnswer[i]) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <div className="space-y-4">
        <div className="card">
          <h3 className="font-semibold">Review "{draft.targetRole}"</h3>
          <p className="text-sm text-slate-600">Untick anything that's wrong. Only ticked items are saved. Nothing has been saved yet.</p>
          {draft.warnings.map((w) => (
            <p key={w} className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">{w}</p>
          ))}
        </div>

        {draft.answers.length > 0 && (
          <section className="card">
            <h4 className="mb-2 text-sm font-semibold">Details for autofill</h4>
            <ul className="space-y-1 text-sm">
              {draft.answers.map((a, i) => (
                <li key={a.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={useAnswer[i] ?? false} aria-label={a.label}
                    onChange={(e) => setUseAnswer((u) => u.map((v, j) => (j === i ? e.target.checked : v)))} />
                  <span className="w-40 shrink-0 text-slate-500">{a.label}</span>
                  <span className="truncate">{a.value}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          <h4 className="mb-2 text-sm font-semibold">Experience bullets ({useBullet.filter(Boolean).length} of {draft.bullets.length})</h4>
          <ul className="space-y-3">
            {draft.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <input type="checkbox" className="mt-1.5" checked={useBullet[i] ?? false} aria-label={`Keep bullet ${i + 1}`}
                  onChange={(e) => setUseBullet((u) => u.map((v, j) => (j === i ? e.target.checked : v)))} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">{b.category} · {b.title}</p>
                  <textarea className="input mt-0.5" rows={2} value={b.bulletText}
                    onChange={(e) => setDraft({ ...draft, bullets: draft.bullets.map((x, j) => (j === i ? { ...x, bulletText: e.target.value } : x)) })} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save resume'}</button>
          <button className="btn-ghost" onClick={() => setDraft(null)} disabled={busy}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={parse} className="card space-y-4">
      <div>
        <label htmlFor="role" className="mb-1 block text-sm font-medium">Which position is this resume for?</label>
        <input id="role" className="input" list="roles" required minLength={2} placeholder="e.g. SDE-2 Backend"
          value={targetRole} onChange={(e) => setTargetRole(e.target.value)} />
        <datalist id="roles">{ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
        <p className="mt-1 text-xs text-slate-500">Used to pick the right resume for each job automatically.</p>
      </div>

      <div>
        <label htmlFor="file" className="mb-1 block text-sm font-medium">Resume file (PDF, DOCX or TXT, up to 5 MB)</label>
        <input id="file" type="file" accept=".pdf,.docx,.txt,.md" className="block w-full text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      <div>
        <label htmlFor="paste" className="mb-1 block text-sm font-medium">…or paste the text</label>
        <textarea id="paste" rows={6} className="input font-mono" disabled={Boolean(file)}
          placeholder={file ? 'Remove the file to paste text instead' : 'Paste your resume text'} value={text}
          onChange={(e) => setText(e.target.value)} />
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn" disabled={busy || targetRole.trim().length < 2}>{busy ? 'Reading your resume…' : 'Read resume'}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
