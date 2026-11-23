import { extractPage, type PageData } from './extract';
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
    case 'failed': setStatus(run.error, 'error'); break;
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
    pageInfo.textContent = `${page.fromSelection ? 'Selected text from' : 'Detected on'}: ${page.url}`;
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
  const reply = await send({ type: 'analyze', sourceUrl: page?.url ?? 'https://unknown.invalid', rawJdText: text });
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

  await readActiveTab();
  const run = await loadRun();
  render(run);
  // Opening the popup acknowledges a finished run's badge.
  if (run.phase === 'completed' || run.phase === 'failed') void chrome.action.setBadgeText({ text: '' });
}

void init();
