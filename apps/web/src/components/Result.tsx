import { useState } from 'react';
import type { Application } from '../types';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = score >= 75 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  return (
    <div className="relative h-24 w-24 shrink-0" role="img" aria-label={`Match score ${score} out of 100`}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{score}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">match</span>
      </div>
    </div>
  );
}

export function Result({ application: a, cached }: { application: Application; cached?: boolean }) {
  if (a.status === 'FAILED') {
    return (
      <div className="card border-red-200 bg-red-50 text-sm text-red-800">
        <p className="font-semibold">Analysis failed</p>
        <p className="mt-1">{a.errorMessage ?? 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-5">
        <ScoreRing score={a.matchScore ?? 0} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{a.roleTitle ?? 'Role'}</h2>
          <p className="text-slate-600">{a.companyName ?? 'Company'}</p>
          <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-brand-600 hover:underline">
            {a.sourceUrl}
          </a>
          <p className="mt-2 text-xs text-slate-500">
            {cached && <span className="mr-2 rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">cached</span>}
            {a.tokensUsed != null && `${a.tokensUsed.toLocaleString()} tokens`}
            {a.processingTimeMs != null && ` · ${(a.processingTimeMs / 1000).toFixed(1)}s`}
          </p>
        </div>
      </div>

      <section className="card">
        <h3 className="mb-2 text-sm font-semibold">Missing keywords</h3>
        {a.missingKeywords.length === 0 ? (
          <p className="text-sm text-slate-500">None. Your experience covers the posting.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {a.missingKeywords.map((k) => (
              <span key={k} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                {k}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="mb-3 text-sm font-semibold">Tailored bullets</h3>
        <ul className="space-y-4">
          {(a.tailoredBullets ?? []).map((b) => (
            <li key={b.sourceChunkId} className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Original</p>
              <p className="text-sm text-slate-500">{b.originalBullet}</p>
              <div className="mt-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Tailored</p>
                  <p className="text-sm font-medium">{b.tailoredBullet}</p>
                </div>
                <CopyButton text={b.tailoredBullet} />
              </div>
              <p className="mt-2 text-xs italic text-slate-500">{b.rationale}</p>
            </li>
          ))}
        </ul>
        {(a.tailoredBullets ?? []).length > 0 && (
          <div className="mt-3 text-right">
            <CopyButton text={(a.tailoredBullets ?? []).map((b) => `• ${b.tailoredBullet}`).join('\n')} label="Copy all" />
          </div>
        )}
      </section>

      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Outreach draft</h3>
          {a.outreachDraft && <CopyButton text={a.outreachDraft} />}
        </div>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{a.outreachDraft}</p>
      </section>
    </div>
  );
}
