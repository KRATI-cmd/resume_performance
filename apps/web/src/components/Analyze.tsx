import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, streamJob } from '../api';
import type { Application, Stage } from '../types';
import { Result } from './Result';

const STAGES: { key: Stage; label: string }[] = [
  { key: 'embedding', label: 'Reading the job description' },
  { key: 'retrieval', label: 'Finding your most relevant experience' },
  { key: 'generation', label: 'Tailoring bullets' },
  { key: 'saving', label: 'Saving' },
];

type Props = { userId: string; initial?: Application | null; onDone?: () => void };

export function Analyze({ userId, initial, onDone }: Props) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [rawJdText, setRawJdText] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ application: Application; cached: boolean } | null>(
    initial ? { application: initial, cached: false } : null,
  );
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => () => unsubscribe.current?.(), []);
  useEffect(() => {
    if (initial) setResult({ application: initial, cached: false });
  }, [initial]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setStage(null);
    setBusy(true);
    try {
      const { cached, application } = await api.analyze(sourceUrl.trim(), rawJdText);
      if (cached) {
        setResult({ application, cached: true });
        setBusy(false);
        return;
      }
      unsubscribe.current?.();
      unsubscribe.current = streamJob(application.id, userId, (evt) => {
        if (evt.status === 'PROCESSING') {
          if (evt.stage) setStage(evt.stage);
          return;
        }
        setBusy(false);
        if (evt.status === 'COMPLETED' && evt.application) setResult({ application: evt.application, cached: false });
        else setError(evt.error ?? 'Analysis failed');
        onDone?.();
      });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  const stageIdx = stage ? STAGES.findIndex((s) => s.key === stage) : -1;

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label htmlFor="url" className="mb-1 block text-sm font-medium">Job URL</label>
          <input id="url" type="url" required className="input" placeholder="https://company.com/careers/123"
            value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} disabled={busy} />
        </div>
        <div>
          <label htmlFor="jd" className="mb-1 block text-sm font-medium">Job description</label>
          <textarea id="jd" required minLength={50} rows={10} className="input font-mono"
            placeholder="Paste the full job description…" value={rawJdText}
            onChange={(e) => setRawJdText(e.target.value)} disabled={busy} />
          <p className="mt-1 text-xs text-slate-500">{rawJdText.trim().length.toLocaleString()} / 50,000 characters</p>
        </div>
        <button className="btn" disabled={busy || rawJdText.trim().length < 50}>
          {busy ? 'Analyzing…' : 'Analyze & tailor'}
        </button>
      </form>

      {busy && (
        <div className="card" aria-live="polite">
          <ol className="space-y-2 text-sm">
            {STAGES.map((s, i) => (
              <li key={s.key} className={i < stageIdx ? 'text-green-700' : i === stageIdx ? 'font-medium text-brand-700' : 'text-slate-400'}>
                {i < stageIdx ? '✓' : i === stageIdx ? '●' : '○'} {s.label}
              </li>
            ))}
          </ol>
        </div>
      )}

      {error && <div role="alert" className="card border-red-200 bg-red-50 text-sm text-red-800">{error}</div>}
      {result && <Result application={result.application} cached={result.cached} />}
    </div>
  );
}
