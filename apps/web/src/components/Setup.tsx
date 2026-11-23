import { useState, type FormEvent } from 'react';
import { api, session } from '../api';

export function Setup({ onReady }: { onReady: (userId: string) => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [headline, setHeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const profile = await api.saveProfile({ email, fullName, headline: headline || undefined });
      session.set(profile.id);
      onReady(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto mt-16 max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-bold">ApplyFlow</h1>
        <p className="text-sm text-slate-600">Create or restore your profile to start tailoring applications.</p>
      </div>
      <input className="input" type="email" required placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" required placeholder="Full name" aria-label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <input className="input" placeholder="Headline (optional)" aria-label="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? 'Working…' : 'Continue'}</button>
    </form>
  );
}
