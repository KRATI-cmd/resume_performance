import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { applyValues, scanFields } from './formScan';
import { buildAnswerMap, keyFor, planFill } from './matcher';

const HTML = `
<input type="search" id="top-search" aria-label="Search jobs">
<div role="dialog" class="jobs-easy-apply-modal">
  <div><label for="e">Email address *</label><input id="e" type="email"></div>
  <div><label for="p">Mobile phone number</label><input id="p" type="text" value="9876543210"></div>
  <div><label for="n">How many years of work experience do you have with Node.js?</label><input id="n" type="text"></div>
  <div><label for="why">Why do you want this job?</label><textarea id="why"></textarea></div>
  <div><label for="s">Notice period</label>
    <select id="s"><option value="">Select an option</option><option value="15">15 days</option><option value="30">30 days</option></select></div>
  <fieldset><legend><span>Are you comfortable commuting?</span></legend>
    <input type="radio" id="y" name="commute" value="Yes"><label for="y">Yes</label>
    <input type="radio" id="no" name="commute" value="No"><label for="no">No</label></fieldset>
  <input type="password" id="pw"><input type="text" name="otp_code" aria-label="Enter code">
  <input type="checkbox" id="consent"><label for="consent">I certify the above is true</label>
</div>`;

function setup(): JSDOM {
  const dom = new JSDOM(`<!doctype html><body>${HTML}</body>`);
  const w = dom.window as unknown as Record<string, unknown>;
  // jsdom has no layout: pretend everything is rendered.
  (w.HTMLElement as { prototype: { getClientRects: () => unknown[] } }).prototype.getClientRects = () => [{}];
  for (const k of ['document', 'getComputedStyle', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event']) {
    (globalThis as Record<string, unknown>)[k] = w[k];
  }
  return dom;
}

describe('scanFields + applyValues on Easy Apply-style markup', () => {
  const dom = setup();
  const fields = scanFields();

  it('scans the modal only and skips search, password, OTP and checkboxes', () => {
    const labels = fields.map((f) => f.label);
    assert.ok(labels.includes('Email address'));
    assert.ok(labels.includes('Are you comfortable commuting?'));
    assert.equal(labels.some((l) => /search|enter code|certify/i.test(l)), false);
    assert.equal(fields.some((f) => f.type === 'password'), false);
  });

  it('detects what is already filled', () => {
    assert.equal(fields.find((f) => f.label.startsWith('Mobile'))?.empty, false);
    assert.equal(fields.find((f) => f.label === 'Notice period')?.empty, true);
    assert.equal(fields.find((f) => f.kind === 'radio')?.options?.length, 2);
  });

  it('fills empty fields from saved answers like a user would, and leaves the rest', () => {
    const radio = fields.find((f) => f.kind === 'radio')!;
    const answers = buildAnswerMap(
      [
        { key: 'email', label: 'Email', value: 'asha@example.com' },
        { key: 'phone', label: 'Phone', value: '1111111111' },
        { key: 'notice_period', label: 'Notice', value: '30 days' },
        { key: 'years_experience_node.js', label: 'Node', value: '3' },
        { key: keyFor(radio), label: 'Commute', value: 'Yes' },
      ],
    );
    const plan = planFill(fields, answers);
    const filledRefs = applyValues(plan.items);
    const d = dom.window.document;

    assert.equal((d.getElementById('e') as HTMLInputElement).value, 'asha@example.com');
    assert.equal((d.getElementById('n') as HTMLInputElement).value, '3');
    assert.equal((d.getElementById('s') as HTMLSelectElement).value, '30');
    assert.equal((d.getElementById('y') as HTMLInputElement).checked, true);
    assert.equal((d.getElementById('p') as HTMLInputElement).value, '9876543210', 'pre-filled value must not be overwritten');
    assert.equal((d.getElementById('why') as HTMLTextAreaElement).value, '');
    assert.deepEqual(plan.needsYou, ['Why do you want this job?']);
    assert.equal(filledRefs.length, 4);
  });

  it('fires input/change events so framework-controlled inputs notice', () => {
    const d = dom.window.document;
    const target = d.getElementById('why') as HTMLTextAreaElement;
    target.setAttribute('data-applyflow-ref', 'zz1');
    const seen: string[] = [];
    for (const t of ['input', 'change']) target.addEventListener(t, () => seen.push(t));
    applyValues([{ ref: 'zz1', kind: 'text', value: 'Because.' }]);
    assert.deepEqual(seen, ['input', 'change']);
  });
});
