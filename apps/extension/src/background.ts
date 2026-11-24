import { runAutofill } from './autofill';
import { api, ApiError } from './client';
import { loadRun, loadSettings, saveRun, saveSettings, type Application, type Message, type Reply, type Settings } from './shared';

const POLL_MS = 2000;
const MAX_WAIT_MS = 3 * 60_000;

async function setBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

const scoreColor = (n: number) => (n >= 75 ? '#16a34a' : n >= 50 ? '#d97706' : '#dc2626');

const NOTIFICATION_ID = 'applyflow-result';

/** Desktop notification so the user doesn't have to notice the badge. Never throws. */
async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon128.png'),
      title,
      message,
      priority: 2,
      requireInteraction: false,
    });
  } catch {
    /* notifications disabled by the OS or user: the badge still works */
  }
}

async function finish(application: Application, cached: boolean): Promise<void> {
  if (application.status === 'FAILED') {
    const error = application.errorMessage ?? 'Analysis failed';
    await saveRun({ phase: 'failed', error, sourceUrl: application.sourceUrl });
    await setBadge('!', '#dc2626');
    await notify('ApplyFlow: analysis failed', error.slice(0, 200));
    return;
  }
  await saveRun({ phase: 'completed', application, cached });
  await setBadge(String(application.matchScore ?? '✓'), scoreColor(application.matchScore ?? 0));
  // A cached result returns instantly while the popup is open, so no notification is needed.
  if (!cached) {
    const where = [application.roleTitle, application.companyName].filter(Boolean).join(' at ');
    await notify(`ApplyFlow: ${application.matchScore ?? 0}% match`, `${where || 'Your job'} is ready. Click to view.`);
  }
}

/**
 * Polls instead of holding an SSE connection: each fetch is a network event that keeps the
 * MV3 service worker alive, and the loop survives the popup being closed.
 */
async function pollUntilDone(settings: Settings, id: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const { data } = await api<{ application: Application }>(settings, `/jobs/${id}`);
    if (data.application.status !== 'PROCESSING') return finish(data.application, false);
  }
  await saveRun({ phase: 'failed', error: 'Timed out waiting for the analysis.' });
  await setBadge('!', '#dc2626');
}

async function analyze(msg: Extract<Message, { type: 'analyze' }>): Promise<void> {
  const settings = await loadSettings();
  await setBadge('…', '#6366f1');
  const { data, status } = await api<{ cached: boolean; application: Application }>(settings, '/jobs/analyze', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: msg.sourceUrl, rawJdText: msg.rawJdText, ...(msg.resumeId ? { resumeId: msg.resumeId } : {}) }),
  });

  if (status === 200 && data.cached) return finish(data.application, true);

  await saveRun({ phase: 'processing', applicationId: data.application.id, sourceUrl: msg.sourceUrl });
  // Detached on purpose: the caller gets its reply as soon as the job is accepted.
  void pollUntilDone(settings, data.application.id).catch(async (err: unknown) => {
    await saveRun({ phase: 'failed', error: err instanceof Error ? err.message : 'Unexpected error' });
    await setBadge('!', '#dc2626');
  });
}

async function connect(input: Settings): Promise<Settings> {
  const apiUrl = input.apiUrl.replace(/\/$/, '');
  const origin = `${new URL(apiUrl).origin}/*`;
  // Custom API origins need an explicit host permission (localhost:4000 is pre-granted).
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) throw new ApiError(`Permission to reach ${origin} was not granted.`);
  }
  const next = { ...input, apiUrl };
  const { data } = await api<{ profile: { id: string } }>(
    next,
    '/profile',
    { method: 'POST', body: JSON.stringify({ email: next.email, fullName: next.fullName }) },
    false,
  );
  const saved = { ...next, userId: data.profile.id };
  await saveSettings(saved);
  return saved;
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: Reply) => void) => {
  const fail = (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Unexpected error' });

  if (msg.type === 'analyze') {
    analyze(msg).then(() => sendResponse({ ok: true })).catch(async (err) => {
      await saveRun({ phase: 'failed', error: err instanceof Error ? err.message : 'Unexpected error' });
      await setBadge('!', '#dc2626');
      fail(err);
    });
    return true;
  }
  if (msg.type === 'connect') {
    connect(msg.settings).then((settings) => sendResponse({ ok: true, settings })).catch(fail);
    return true;
  }
  if (msg.type === 'reset') {
    saveRun({ phase: 'idle' }).then(() => setBadge('', '#000000')).then(() => sendResponse({ ok: true })).catch(fail);
    return true;
  }
  return false;
});

// Clicking the notification opens the popup (Chrome 127+); otherwise falls back to the web app.
chrome.notifications.onClicked.addListener((id) => {
  if (id !== NOTIFICATION_ID) return;
  void chrome.notifications.clear(id);
  chrome.action.openPopup().catch(async () => {
    const { webUrl } = await loadSettings();
    await chrome.tabs.create({ url: webUrl });
  });
});

// Alt+Shift+F: autofill the current page/step without opening the popup. Essential for
// multi-step forms (Easy Apply) because clicking the page closes the popup.
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'autofill') return;
  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('This page cannot be autofilled.');
      const { plan, filledCount, scanned } = await runAutofill(tab.id);
      if (scanned === 0) return void (await notify('ApplyFlow autofill', 'No form fields found on this page or step.'));
      const need = plan.needsYou.length;
      await notify(
        `ApplyFlow: filled ${filledCount} field${filledCount === 1 ? '' : 's'}`,
        need ? `${need} still need you: ${plan.needsYou.slice(0, 3).join('; ')}${need > 3 ? '…' : ''}` : 'Review the highlighted fields, then continue.',
      );
    } catch (err) {
      await notify('ApplyFlow autofill failed', err instanceof Error ? err.message : 'Unexpected error');
    }
  })();
});

// If the worker was restarted mid-job, resume polling for it.
chrome.runtime.onStartup.addListener(() => void resume());
chrome.runtime.onInstalled.addListener(() => void resume());
async function resume(): Promise<void> {
  const run = await loadRun();
  if (run.phase !== 'processing') return;
  const settings = await loadSettings();
  void pollUntilDone(settings, run.applicationId).catch(() => undefined);
}
