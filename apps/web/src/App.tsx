import { useCallback, useEffect, useState } from 'react';
import { api, session } from './api';
import { Analyze } from './components/Analyze';
import { Autofill } from './components/Autofill';
import { History } from './components/History';
import { Resumes } from './components/Resumes';
import { Setup } from './components/Setup';
import type { Application, Resume } from './types';

type Tab = 'analyze' | 'resumes' | 'autofill' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'analyze', label: 'Analyze job' },
  { key: 'resumes', label: 'Resumes' },
  { key: 'autofill', label: 'Autofill details' },
  { key: 'history', label: 'History' },
];

export default function App() {
  const [userId, setUserId] = useState<string | null>(session.get());
  const [tab, setTab] = useState<Tab>('analyze');
  const [opened, setOpened] = useState<Application | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resumes, setResumes] = useState<Resume[] | null>(null);

  const loadResumes = useCallback(async () => {
    try {
      const list = await api.listResumes();
      setResumes(list);
      // First-time users start by adding a resume.
      if (list.length === 0) setTab('resumes');
    } catch {
      setResumes([]);
    }
  }, []);

  useEffect(() => {
    if (userId) void loadResumes();
  }, [userId, loadResumes]);

  if (!userId) return <Setup onReady={setUserId} />;

  const needsResume = resumes !== null && resumes.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-700">ApplyFlow</h1>
        <button className="btn-ghost" onClick={() => { session.clear(); setUserId(null); setResumes(null); }}>Sign out</button>
      </header>

      <nav className="mb-6 flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            // Until a resume exists nothing else is useful, so steer first-time users.
            disabled={needsResume && t.key !== 'resumes' && t.key !== 'autofill'}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
              tab === t.key ? 'bg-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'analyze' && (
        <Analyze key={opened?.id ?? 'new'} userId={userId} resumes={resumes ?? []} initial={opened} onDone={() => setRefreshKey((k) => k + 1)} />
      )}
      {tab === 'resumes' && <Resumes onboarding={needsResume} onChanged={() => void loadResumes()} />}
      {tab === 'autofill' && <Autofill />}
      {tab === 'history' && (
        <History
          refreshKey={refreshKey}
          onOpen={(a) => {
            setOpened(a);
            setTab('analyze');
          }}
        />
      )}
    </div>
  );
}
