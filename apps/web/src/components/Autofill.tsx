import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Answer } from '../types';

/** Keep in sync with CANONICAL in apps/extension/src/matcher.ts. */
const COMMON: { key: string; label: string; placeholder: string }[] = [
  { key: 'full_name', label: 'Full name', placeholder: 'Jane Doe' },
  { key: 'first_name', label: 'First name', placeholder: 'Jane' },
  { key: 'last_name', label: 'Last name', placeholder: 'Doe' },
  { key: 'email', label: 'Email', placeholder: 'jane@example.com' },
  { key: 'phone', label: 'Phone', placeholder: '+91 98765 43210' },
  { key: 'city', label: 'Current location / city', placeholder: 'Meerut, UP' },
  { key: 'linkedin', label: 'LinkedIn profile', placeholder: 'https://linkedin.com/in/…' },
  { key: 'github', label: 'GitHub profile', placeholder: 'https://github.com/…' },
  { key: 'portfolio', label: 'Portfolio / website', placeholder: 'https://…' },
  { key: 'current_company', label: 'Current company', placeholder: '' },
  { key: 'current_title', label: 'Current job title', placeholder: '' },
  { key: 'total_experience', label: 'Total years of experience', placeholder: '3' },
  { key: 'current_ctc', label: 'Current CTC', placeholder: '' },
  { key: 'expected_ctc', label: 'Expected CTC', placeholder: '' },
  { key: 'notice_period', label: 'Notice period', placeholder: '30 days' },
];

export function Autofill() {
  const [saved, setSaved] = useState<Answer[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    try {
      const answers = await api.listAnswers();
      setSaved(answers);
      setValues(Object.fromEntries(answers.map((a) => [a.key, a.value])));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not load' });
    }
  };
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!saved) return;
    const savedByKey = new Map(saved.map((a) => [a.key, a]));
    const changed: Answer[] = [];
    for (const f of COMMON) {
      const v = (values[f.key] ?? '').trim();
      if (v && v !== savedByKey.get(f.key)?.value) changed.push({ key: f.key, label: f.label, value: v });
    }
    for (const a of saved) {
      if (COMMON.some((f) => f.key === a.key)) continue;
      const v = (values[a.key] ?? '').trim();
      if (v && v !== a.value) changed.push({ key: a.key, label: a.label, value: v });
    }
    if (changed.length === 0) return setMsg({ ok: true, text: 'Nothing to save.' });
    setBusy(true);
    try {
      await api.saveAnswers(changed);
      setMsg({ ok: true, text: `Saved ${changed.length} item${changed.length === 1 ? '' : 's'}.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Answer) {
    if (!a.id) return;
    await api.deleteAnswer(a.id).catch(() => undefined);
    await load();
  }

  const learned = (saved ?? []).filter((a) => !COMMON.some((f) => f.key === a.key));

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        These are used by the Chrome extension to autofill application forms (LinkedIn Easy Apply and career sites). Fill them once. Answers you give on new questions can be saved from the extension.
      </p>

      <section className="card grid gap-3 sm:grid-cols-2">
        {COMMON.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block text-slate-600">{f.label}</span>
            <input className="input" placeholder={f.placeholder} value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          </label>
        ))}
      </section>

      {learned.length > 0 && (
        <section className="card">
          <h3 className="mb-3 text-sm font-semibold">Answers learned from forms</h3>
          <ul className="space-y-2">
            {learned.map((a) => (
              <li key={a.key} className="flex items-center gap-2">
                <span className="w-1/2 truncate text-sm text-slate-600" title={a.label}>{a.label}</span>
                <input className="input" aria-label={a.label} value={values[a.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [a.key]: e.target.value }))} />
                <button className="btn-ghost text-red-700" onClick={() => remove(a)}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button className="btn" onClick={save} disabled={busy || !saved}>{busy ? 'Saving…' : 'Save details'}</button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
