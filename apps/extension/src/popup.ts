import { extractPage, type PageData } from './extract';
import { runAutofill, scanTab } from './autofill';
import { api } from './client';
import { checkJobText } from './jobCheck';
import { collectLearnable, type Learnable } from './matcher';
import { DEFAULT_SETTINGS, loadRun, loadSettings, STORAGE, type Application, type Message, type Reply, type RunState, type Settings } from './shared';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const jd = $<HTMLTextAreaElement>('jd');
const analyzeBtn = $<HTMLButtonElement>('analyze');
const statusEl = $('status');
const resultEl = $('result');
const pageInfo = $('page-info');
const settingsEl = $('settings');
const settingsMsg = $('settings-msg');

let page: PageData | null = null;
let settings: Settings = DEFAULT_SETTINGS;

const hintEl = $('hint');
const resumeSelect = $<HTMLSelectElement>('resume');
let resumes: { id: string; targetRole: string }[] = [];

async function loadResumes(): Promise<void> {
  if (!settings.userId) return;
  try {
    const { data } = await api<{ resumes: { id: string; targetRole: string }[] }>(settings, '/resumes');
    resumes = data.resumes;
    const stored = (await chrome.storage.local.get('resumeId')).resumeId as string | undefined;
    resumeSelect.replaceChildren(
      el('option', { value: '', textContent: resumes.length ? 'Auto: best match for this job' : 'No resumes yet (add one in the web app)' }),
      ...resumes.map((r) => el('option', { value: r.id, textContent: r.targetRole })),
    );
    if (stored && resumes.some((r) => r.id === stored)) resumeSelect.value = stored;
  } catch {
    /* picker stays on "Auto"; analysis still works */
  }
}
resumeSelect.addEventListener('change', () => void chrome.storage.local.set({ resumeId: resumeSelect.value }));

/** Warns (never blocks) when the text doesn't look like a single job description. */
function refreshHint(): void {
  const text = jd.value.trim();
  const check = text.length === 0 ? { isJob: true, reason: '' } : checkJobText(text);
  hintEl.hidden = check.isJob;
  hintEl.textContent = check.reason;
  analyzeBtn.classList.toggle('caution', !check.isJob);
  analyzeBtn.textContent = check.isJob ? 'Analyze & tailor' : 'Analyze anyway';
}
jd.addEventListener('input', refreshHint);

const send = (msg: Message) => chrome.runtime.sendMessage<Message, Reply>(msg);

function setStatus(text: string, kind: '' | 'error' | 'ok' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `msg ${kind}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function copyButton(text: string): HTMLButtonElement {
  const b = el('button', { className: 'copy', type: 'button', textContent: 'Copy' });
  b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    b.textContent = 'Copied ✓';
    setTimeout(() => (b.textContent = 'Copy'), 1200);
  });
  return b;
}

// All DOM built with textContent (never innerHTML): JD-derived strings are untrusted.
function renderResult(a: Application, cached: boolean): void {
  const card = el('div', { className: 'card' });
  card.append(
    el('div', { className: 'score' },
      el('b', { textContent: String(a.matchScore ?? 0) }),
      el('div', {}, el('div', { textContent: a.roleTitle ?? 'Role' }), el('div', { className: 'muted', textContent: `${a.companyName ?? 'Company'}${cached ? ' · cached' : ''}` }))),
  );
  const used = resumes.find((r) => r.id === a.resumeId);
  if (used) card.append(el('div', { className: 'muted', textContent: `Resume used: ${used.targetRole}${a.resumeAutoSelected ? ' (auto-selected)' : ''}` }));
  if (a.missingKeywords.length) {
    card.append(el('div', { className: 'muted', textContent: 'Missing keywords' }));
    card.append(el('div', { className: 'chips' }, ...a.missingKeywords.map((k) => el('span', { className: 'chip', textContent: k }))));
  }
  for (const b of a.tailoredBullets ?? []) {
    card.append(el('div', { className: 'bullet' }, el('p', { textContent: b.tailoredBullet }), copyButton(b.tailoredBullet)));
  }
  if (a.outreachDraft) {
    card.append(el('div', { className: 'bullet' }, el('div', { className: 'muted', textContent: 'Outreach draft' }), el('p', { textContent: a.outreachDraft }), copyButton(a.outreachDraft)));
  }
  const link = el('a', { href: settings.webUrl, target: '_blank', rel: 'noreferrer', textContent: 'Open ApplyFlow →' });
  card.append(el('p', {}, link));
  resultEl.replaceChildren(card);
}

function render(run: RunState): void {
  resultEl.replaceChildren();
  analyzeBtn.disabled = run.phase === 'processing';
  switch (run.phase) {
    case 'idle': setStatus(''); break;
    case 'processing': setStatus('Analyzing… you can close this popup, the badge shows the score when done.'); break;
    case 'failed':
      setStatus(
        /No experience chunks/i.test(run.error)
          ? 'No experience saved for this account yet. Add your resume bullets in the ApplyFlow web app (My experience), then try again.'
          : run.error,
        'error',
      );
      break;
    case 'completed': setStatus('Done', 'ok'); renderResult(run.application, run.cached); break;
  }
}

async function readActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('This page cannot be read.');
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
    page = (injection?.result as PageData | undefined) ?? null;
    if (!page) throw new Error('No content found.');
    jd.value = page.text;
    refreshHint();
    pageInfo.textContent = `${page.fromSelection ? 'Selected text from' : 'Detected on'}: ${page.url}`;
    pageInfo.title = page.url;
  } catch (err) {
    pageInfo.textContent = err instanceof Error ? err.message : 'Could not read the page.';
  }
}

analyzeBtn.addEventListener('click', async () => {
  const text = jd.value.trim();
  if (text.length < 50) return setStatus('Job description must be at least 50 characters.', 'error');
  if (!settings.userId) return setStatus('Open Settings and connect your account first.', 'error');
  setStatus('Submitting…');
  analyzeBtn.disabled = true;
  const reply = await send({
    type: 'analyze',
    sourceUrl: page?.url ?? 'https://unknown.invalid',
    rawJdText: text,
    ...(resumeSelect.value ? { resumeId: resumeSelect.value } : {}),
  });
  if (!reply.ok) {
    setStatus(reply.error, 'error');
    analyzeBtn.disabled = false;
  }
});

$('toggle-settings').addEventListener('click', () => {
  settingsEl.hidden = !settingsEl.hidden;
});

$('connect').addEventListener('click', async () => {
  const next: Settings = {
    ...settings,
    apiUrl: $<HTMLInputElement>('api-url').value.trim(),
    webUrl: $<HTMLInputElement>('web-url').value.trim(),
    email: $<HTMLInputElement>('email').value.trim(),
    fullName: $<HTMLInputElement>('full-name').value.trim(),
  };
  if (!next.email || !next.fullName) {
    settingsMsg.className = 'msg error';
    settingsMsg.textContent = 'Email and full name are required.';
    return;
  }
  settingsMsg.className = 'msg';
  settingsMsg.textContent = 'Connecting…';
  const reply = await send({ type: 'connect', settings: next });
  if (reply.ok && reply.settings) {
    settings = reply.settings;
    settingsMsg.className = 'msg ok';
    settingsMsg.textContent = 'Connected ✓';
  } else if (!reply.ok) {
    settingsMsg.className = 'msg error';
    settingsMsg.textContent = reply.error;
  }
});

/* ---------------- Tabs ---------------- */
const mainEl = $('main');
const formPanel = $('form-panel');
function showTab(which: 'job' | 'form'): void {
  mainEl.hidden = which !== 'job';
  formPanel.hidden = which !== 'form';
  for (const [id, active] of [['tab-job', which === 'job'], ['tab-form', which === 'form']] as const) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-selected', String(active));
  }
}
$('tab-job').addEventListener('click', () => showTab('job'));
$('tab-form').addEventListener('click', () => showTab('form'));

/* ---------------- Autofill ---------------- */
const formStatus = $('form-status');
const formResult = $('form-result');
const fillBtn = $<HTMLButtonElement>('fill');
const learnBtn = $<HTMLButtonElement>('learn');

function setFormStatus(text: string, kind: '' | 'error' | 'ok' = ''): void {
  formStatus.textContent = text;
  formStatus.className = `msg ${kind}`;
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('This page cannot be read.');
  return tab.id;
}

function listOf(rows: [string, string][]): HTMLUListElement {
  return el('ul', { className: 'list' }, ...rows.map(([k, v]) => el('li', {}, el('span', { className: 'k', title: k, textContent: k }), el('span', { className: 'v', title: v, textContent: v }))));
}

fillBtn.addEventListener('click', async () => {
  formResult.replaceChildren();
  if (!settings.userId) return setFormStatus('Open Settings and connect your account first.', 'error');
  fillBtn.disabled = true;
  setFormStatus('Filling…');
  try {
    const { plan, filledCount, scanned } = await runAutofill(await activeTabId());
    if (scanned === 0) {
      setFormStatus('No form fields found. If the form is open in a pop-up step, make sure it is visible, then try again.', 'error');
    } else {
      setFormStatus(`Filled ${filledCount} field${filledCount === 1 ? '' : 's'}. Review them before continuing.`, filledCount ? 'ok' : '');
      if (plan.filled.length) formResult.append(el('div', { className: 'muted', textContent: 'Filled' }), listOf(plan.filled.map((f) => [f.label, f.value])));
      if (plan.needsYou.length) {
        formResult.append(
          el('div', { className: 'muted', textContent: 'Needs you (fill once, then press "Learn from this page")' }),
          listOf(plan.needsYou.map((l) => [l, ''])),
        );
      }
    }
  } catch (err) {
    setFormStatus(err instanceof Error ? err.message : 'Autofill failed', 'error');
  } finally {
    fillBtn.disabled = false;
  }
});

learnBtn.addEventListener('click', async () => {
  formResult.replaceChildren();
  if (!settings.userId) return setFormStatus('Open Settings and connect your account first.', 'error');
  setFormStatus('Reading the fields you filled…');
  try {
    const items: Learnable[] = collectLearnable(await scanTab(await activeTabId()));
    if (items.length === 0) return setFormStatus('Nothing filled in yet. Fill the form yourself, then press this again.');
    setFormStatus('Tick what to save for next time. Nothing is saved until you press Save.');

    const list = document.createElement('ul');
    list.className = 'list';
    const boxes = items.map((it) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !it.long; // free-text answers are opt-in
      const k = document.createElement('span');
      k.className = 'k';
      k.title = k.textContent = it.label;
      const v = document.createElement('span');
      v.className = 'v';
      v.title = v.textContent = it.value;
      const li = document.createElement('li');
      li.append(cb, k, v);
      list.append(li);
      return { it, cb };
    });
    const save = el('button', { type: 'button', textContent: 'Save selected answers' });
    save.addEventListener('click', async () => {
      const chosen = boxes.filter(({ cb }) => cb.checked).map(({ it }) => ({ key: it.key, label: it.label, value: it.value }));
      if (chosen.length === 0) return setFormStatus('Nothing selected.', 'error');
      save.disabled = true;
      try {
        await api(settings, '/profile/answers', { method: 'PUT', body: JSON.stringify({ answers: chosen }) });
        setFormStatus(`Saved ${chosen.length} answer${chosen.length === 1 ? '' : 's'}. They will be filled next time.`, 'ok');
        formResult.replaceChildren();
      } catch (err) {
        save.disabled = false;
        setFormStatus(err instanceof Error ? err.message : 'Could not save', 'error');
      }
    });
    formResult.append(list, save);
  } catch (err) {
    setFormStatus(err instanceof Error ? err.message : 'Could not read the page', 'error');
  }
});

chrome.storage.onChanged.addListener((changes) => {
  const change = changes[STORAGE.run];
  if (change) render((change.newValue as RunState | undefined) ?? { phase: 'idle' });
});

async function init(): Promise<void> {
  settings = await loadSettings();
  $<HTMLInputElement>('api-url').value = settings.apiUrl;
  $<HTMLInputElement>('web-url').value = settings.webUrl;
  $<HTMLInputElement>('email').value = settings.email;
  $<HTMLInputElement>('full-name').value = settings.fullName;
  settingsEl.hidden = Boolean(settings.userId);

  await loadResumes();
  await readActiveTab();
  const run = await loadRun();
  render(run);
  // Opening the popup acknowledges a finished run's badge.
  if (run.phase === 'completed' || run.phase === 'failed') void chrome.action.setBadgeText({ text: '' });
}

void init();
