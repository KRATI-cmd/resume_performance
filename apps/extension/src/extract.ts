export type PageData = { url: string; title: string; text: string; fromSelection: boolean };

/**
 * Injected into the page via chrome.scripting.executeScript, so it is serialised:
 * it MUST be self-contained (no references to module-level variables or imports).
 */
export function extractPage(): PageData {
  const MAX = 50_000;
  const base = { url: location.href, title: document.title };

  const selected = (window.getSelection()?.toString() ?? '').trim();
  if (selected.length >= 50) return { ...base, text: selected.slice(0, MAX), fromSelection: true };

  const selectors = [
    '[data-testid="job-description"]',
    '.show-more-less-html__markup', // LinkedIn
    '#jobDescriptionText', // Indeed
    '[class*="job-description" i]',
    '[id*="job-description" i]',
    '[class*="jobDescription" i]',
    'article',
    'main',
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.innerText?.trim() ?? '';
    if (text.length >= 200) return { ...base, text: text.slice(0, MAX), fromSelection: false };
  }

  return { ...base, text: (document.body?.innerText ?? '').trim().slice(0, MAX), fromSelection: false };
}
