import { useState } from 'react';
import { session } from './api';
import { Analyze } from './components/Analyze';
import { Experience } from './components/Experience';
import { History } from './components/History';
import { Setup } from './components/Setup';
import type { Application } from './types';

type Tab = 'analyze' | 'experience' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'analyze', label: 'Analyze job' },
  { key: 'experience', label: 'My experience' },
  { key: 'history', label: 'History' },
];

export default function App() {
  const [userId, setUserId] = useState<string | null>(session.get());
  const [tab, setTab] = useState<Tab>('analyze');
  const [opened, setOpened] = useState<Application | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!userId) return <Setup onReady={setUserId} />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-700">ApplyFlow</h1>
        <button className="btn-ghost" onClick={() => { session.clear(); setUserId(null); }}>Sign out</button>
      </header>

      <nav className="mb-6 flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'analyze' && (
        <Analyze key={opened?.id ?? 'new'} userId={userId} initial={opened} onDone={() => setRefreshKey((k) => k + 1)} />
      )}
      {tab === 'experience' && <Experience />}
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
