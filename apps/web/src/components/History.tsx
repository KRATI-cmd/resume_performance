import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Application } from '../types';

const badge: Record<Application['status'], string> = {
  COMPLETED: 'bg-green-50 text-green-700 ring-green-200',
  PROCESSING: 'bg-amber-50 text-amber-700 ring-amber-200',
  FAILED: 'bg-red-50 text-red-700 ring-red-200',
};

export function History({ refreshKey, onOpen }: { refreshKey: number; onOpen: (a: Application) => void }) {
  const [items, setItems] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listJobs().then((r) => !cancelled && setItems(r)).catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!items) return <p className="text-sm text-slate-500">Loading…</p>;
  if (items.length === 0) return <p className="text-sm text-slate-500">No applications yet. Analyze a job to get started.</p>;

  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id}>
          <button
            className="card flex w-full items-center justify-between gap-3 text-left transition hover:border-brand-500"
            onClick={async () => onOpen(await api.getJob(a.id))}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{a.roleTitle ?? 'Untitled role'} <span className="font-normal text-slate-500">· {a.companyName ?? '—'}</span></p>
              <p className="truncate text-xs text-slate-500">{a.sourceUrl}</p>
              <p className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {a.matchScore != null && <span className="text-lg font-bold">{a.matchScore}</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${badge[a.status]}`}>{a.status.toLowerCase()}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
