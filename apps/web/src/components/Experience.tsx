import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { ChunkInput } from '../types';

type Row = { category: string; title: string; bulletText: string; tags: string };
const blank = (): Row => ({ category: 'work', title: '', bulletText: '', tags: '' });

export function Experience() {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const chunks: ChunkInput[] = rows
      .filter((r) => r.bulletText.trim())
      .map((r) => ({
        category: r.category.trim() || 'work',
        title: r.title.trim(),
        bulletText: r.bulletText.trim(),
        tags: r.tags.split(',').map((t) => t.trim()).filter(Boolean),
      }));
    if (chunks.length === 0) return setMsg({ ok: false, text: 'Add at least one bullet.' });
    setBusy(true);
    try {
      const { created } = await api.addChunks(chunks);
      setMsg({ ok: true, text: `Saved ${created} bullet${created === 1 ? '' : 's'}.` });
      setRows([blank()]);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">
        Add real accomplishments from your resume. The AI may only reword these. It is told never to invent metrics or skills.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <select className="input" aria-label="Category" value={r.category} onChange={(e) => update(i, { category: e.target.value })}>
              <option value="work">Work</option>
              <option value="project">Project</option>
              <option value="education">Education</option>
              <option value="other">Other</option>
            </select>
            <input className="input sm:col-span-2" aria-label="Title" placeholder="Role / project (e.g. SDE-1 at Acme)"
              required value={r.title} onChange={(e) => update(i, { title: e.target.value })} />
          </div>
          <textarea className="input" rows={2} aria-label="Bullet" placeholder="Reduced API p95 latency by 40% by adding Redis caching…"
            minLength={10} value={r.bulletText} onChange={(e) => update(i, { bulletText: e.target.value })} />
          <div className="flex items-center gap-3">
            <input className="input" aria-label="Tags" placeholder="Tags, comma separated (node, redis)"
              value={r.tags} onChange={(e) => update(i, { tags: e.target.value })} />
            {rows.length > 1 && (
              <button type="button" className="btn-ghost shrink-0" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button type="button" className="btn-ghost" onClick={() => setRows((rs) => [...rs, blank()])} disabled={rows.length >= 100}>
          + Add another
        </button>
        <button className="btn" disabled={busy}>{busy ? 'Embedding…' : 'Save experience'}</button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
