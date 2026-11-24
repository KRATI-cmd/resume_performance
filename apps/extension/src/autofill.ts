import { api } from './client';
import { applyValues, scanFields, type FieldInfo } from './formScan';
import { buildAnswerMap, planFill, type FillPlan, type SavedAnswer } from './matcher';
import { loadSettings } from './shared';

export async function scanTab(tabId: number): Promise<FieldInfo[]> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: scanFields });
  return (res?.result as FieldInfo[] | undefined) ?? [];
}

export type AutofillResult = { plan: FillPlan; filledCount: number; scanned: number };

/**
 * Fills EMPTY fields on the tab from saved answers. Never submits, never clicks Next, never
 * overwrites what is already there. Needs a user gesture (popup click or keyboard shortcut)
 * so that `activeTab` grants access to the page.
 */
export async function runAutofill(tabId: number): Promise<AutofillResult> {
  const settings = await loadSettings();
  const { data } = await api<{ answers: SavedAnswer[] }>(settings, '/profile/answers');
  const fields = await scanTab(tabId);
  const plan = planFill(fields, buildAnswerMap(data.answers, { fullName: settings.fullName, email: settings.email }));

  let filledCount = 0;
  if (plan.items.length > 0) {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: applyValues, args: [plan.items] });
    filledCount = (res?.result as string[] | undefined)?.length ?? 0;
  }
  return { plan, filledCount, scanned: fields.length };
}
