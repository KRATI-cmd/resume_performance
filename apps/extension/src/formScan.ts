export type FieldOption = { text: string; value: string; ref: string };

export type FieldInfo = {
  /** DOM ref (data-applyflow-ref) for text/select; a synthetic group id for radios. */
  ref: string;
  kind: 'text' | 'select' | 'radio';
  label: string;
  name: string;
  id: string;
  autocomplete: string;
  type: string;
  value: string;
  /** true when the user/page has not filled it yet (placeholder selects count as empty). */
  empty: boolean;
  options?: FieldOption[];
};

export type FillItem = { ref: string; kind: 'text' | 'select' | 'radio'; value: string; optionRef?: string };

/**
 * Injected into the page with chrome.scripting.executeScript, so it is serialised and MUST be
 * self-contained: no imports or module-level variables. Reads the form controls only.
 * If an Easy Apply style modal is open, only that modal is scanned.
 */
export function scanFields(): FieldInfo[] {
  const SKIP_TYPES = ['hidden', 'password', 'submit', 'button', 'image', 'reset', 'file', 'search', 'range', 'color', 'checkbox'];
  const SENSITIVE = /pass(word)?|otp|one.?time|cvv|cvc|card.?(number|no)|ssn|aadhaar|aadhar|captcha|csrf|security.?code/i;

  const clean = (s: string | null | undefined): string =>
    (s ?? '').replace(/\s+/g, ' ').replace(/\*/g, '').replace(/\((required|optional)\)/gi, '').trim();
  const textOf = (el: Element | null | undefined): string => clean(el?.textContent);
  const isVisible = (el: Element): boolean => {
    const h = el as HTMLElement;
    const s = getComputedStyle(h);
    return s.display !== 'none' && s.visibility !== 'hidden' && h.getClientRects().length > 0;
  };

  // Scope: prefer the visible dialog with the most form controls (e.g. LinkedIn Easy Apply).
  const CONTROLS = 'input, textarea, select';
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], [aria-modal="true"], .jobs-easy-apply-modal, dialog[open]'),
  ).filter(isVisible);
  let root: ParentNode = document;
  let best = 0;
  for (const d of dialogs) {
    const n = d.querySelectorAll(CONTROLS).length;
    if (n > best) {
      best = n;
      root = d;
    }
  }

  let counter = 0;
  const refOf = (el: Element): string => {
    let ref = el.getAttribute('data-applyflow-ref');
    if (!ref) {
      ref = `af${Date.now().toString(36)}${counter++}`;
      el.setAttribute('data-applyflow-ref', ref);
    }
    return ref;
  };

  const labelsText = (el: Element): string => {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length > 0) return clean(Array.from(labels).map((l) => l.textContent).join(' '));
    return '';
  };

  const labelOf = (el: Element): string => {
    const byFor = labelsText(el);
    if (byFor) return byFor;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
      if (t) return t;
    }
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    const wrapping = el.closest('label');
    if (wrapping) {
      const t = textOf(wrapping);
      if (t) return t;
    }
    // Nearest ancestor that contains a label/legend which does not itself contain the control.
    let p: Element | null = el.parentElement;
    for (let depth = 0; p && depth < 4; depth++, p = p.parentElement) {
      const cand = Array.from(p.querySelectorAll('label, legend')).find((l) => !l.contains(el));
      if (cand) {
        const t = textOf(cand);
        if (t) return t;
      }
    }
    return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title'));
  };

  const out: FieldInfo[] = [];

  // ----- text-like inputs, textareas, selects -----
  for (const el of Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(CONTROLS))) {
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el as HTMLInputElement).type.toLowerCase() : tag;
    if (tag === 'input' && (SKIP_TYPES.includes(type) || type === 'radio')) continue;
    if (el.disabled || (el as HTMLInputElement).readOnly || !isVisible(el)) continue;

    const name = el.getAttribute('name') ?? '';
    const id = el.id ?? '';
    const autocomplete = el.getAttribute('autocomplete') ?? '';
    if (SENSITIVE.test(`${name} ${id} ${autocomplete}`) || /^cc-/.test(autocomplete)) continue;
    const label = labelOf(el);
    if (SENSITIVE.test(label)) continue;

    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options).map((o) => ({ text: clean(o.text), value: o.value, ref: '' }));
      const sel = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : undefined;
      const placeholder = !sel || sel.value === '' || /^(select|choose|please|--)/i.test(clean(sel.text));
      out.push({
        ref: refOf(el), kind: 'select', label, name, id, autocomplete, type,
        value: placeholder ? '' : clean(sel?.text), empty: placeholder, options,
      });
    } else {
      const value = el.value ?? '';
      out.push({
        ref: refOf(el), kind: 'text', label, name, id, autocomplete, type,
        value, empty: value.trim() === '',
      });
    }
  }

  // ----- radio groups (one field per group) -----
  const groups = new Map<string, HTMLInputElement[]>();
  for (const r of Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
    if (r.disabled) continue;
    const key = r.name || r.closest('fieldset')?.id || r.id;
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  for (const [name, radios] of groups) {
    const first = radios[0];
    if (!first) continue;
    const container = first.closest('fieldset, [role="radiogroup"]');
    let label = '';
    const legend = container?.querySelector('legend');
    if (legend) label = textOf(legend);
    if (!label && container) {
      const lb = container.getAttribute('aria-labelledby');
      if (lb) label = clean(lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    }
    if (!label) label = clean(first.getAttribute('aria-label')) || name;
    if (SENSITIVE.test(`${name} ${label}`)) continue;

    const options = radios.map((r) => ({ text: labelsText(r) || clean(r.value), value: r.value, ref: refOf(r) }));
    const checked = radios.find((r) => r.checked);
    const checkedText = checked ? options[radios.indexOf(checked)]?.text ?? '' : '';
    out.push({
      ref: `group:${name}`, kind: 'radio', label, name, id: '', autocomplete: '', type: 'radio',
      value: checkedText, empty: !checked, options,
    });
  }

  return out;
}

/**
 * Injected like scanFields (self-contained). Sets values the way a user would, so React/Vue
 * controlled inputs notice. Never clicks submit/next. Returns the refs it filled.
 */
export function applyValues(items: FillItem[]): string[] {
  const filled: string[] = [];
  const find = (ref: string) => document.querySelector<HTMLElement>(`[data-applyflow-ref="${ref}"]`);
  const fire = (el: Element, ...types: string[]) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  const mark = (el: HTMLElement) => {
    el.style.outline = '2px solid #6366f1';
    el.style.outlineOffset = '1px';
  };

  for (const item of items) {
    try {
      if (item.kind === 'radio') {
        const radio = item.optionRef ? find(item.optionRef) : null;
        if (!(radio instanceof HTMLInputElement)) continue;
        if (!radio.checked) radio.click();
        mark(radio.parentElement ?? radio);
        filled.push(item.ref);
        continue;
      }

      const el = find(item.ref);
      if (!el) continue;
      el.focus();
      if (el instanceof HTMLSelectElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(el, item.value);
        else el.value = item.value;
        fire(el, 'input', 'change', 'blur');
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, item.value);
        else el.value = item.value;
        fire(el, 'input', 'change', 'blur');
      } else {
        continue;
      }
      mark(el);
      filled.push(item.ref);
    } catch {
      /* one bad control must not stop the rest */
    }
  }
  return filled;
}
