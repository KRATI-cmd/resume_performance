import type { FieldInfo, FieldOption, FillItem } from './formScan';

export type SavedAnswer = { key: string; label: string; value: string };

const STOP = new Set([
  'a', 'an', 'the', 'of', 'your', 'you', 'please', 'enter', 'provide', 'select', 'choose', 'is', 'are', 'do', 'does',
  'what', 'how', 'many', 'have', 'has', 'to', 'for', 'and', 'or', 'if', 'any', 'can', 'will', 'would', 'be', 'we',
]);

const camelSplit = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/** `camel` is only for machine names (firstName); human labels like "LinkedIn" must stay intact. */
export const normalize = (s: string, camel = false): string =>
  ((camel ? camelSplit(s) : s).toLowerCase().match(/[a-z0-9+#]+(?:\.[a-z0-9+#]+)*/g) ?? []).join(' ');

const tokens = (s: string): string[] => normalize(s).split(' ').filter((t) => t && !STOP.has(t));
const slug = (ts: string[]) => ts.join('_').slice(0, 100);

/** Keep in sync with the COMMON list in apps/web/src/components/Autofill.tsx. */
const RULES: [string, RegExp][] = [
  ['phone_country_code', /\bcountry code\b/],
  ['first_name', /\b(first|given) name\b|^fname$|^first$/],
  ['last_name', /\b(last|family|sur) ?name\b|^lname$/],
  ['full_name', /^(?:full |your |candidate |applicant )?name$/],
  ['email', /\be ?mail\b/],
  ['phone', /\b(phone|mobile|telephone|cell(?:phone)?)\b|\bcontact (number|no)\b/],
  ['linkedin', /linkedin/],
  ['github', /github/],
  ['current_company', /\b(current|present|recent|latest|last) (company|employer|organi[sz]ation)\b/],
  ['current_title', /\b(current|present|recent|latest) (job )?(title|designation|role|position)\b|^designation$|^job title$/],
  ['current_ctc', /\b(current|present) (ctc|salary|compensation|annual salary|package)\b|\bcurrent annual\b/],
  ['expected_ctc', /\b(expected|desired|target) (ctc|salary|compensation|package)\b|\bsalary expectations?\b/],
  ['notice_period', /\bnotice period\b|\bhow soon can you (join|start)\b|\bjoining time\b|\bearliest (join|start)/],
  ['total_experience', /\b(total|overall) (?:years? of )?(work |professional )?experience\b|^(how many )?years of (professional |work |total )?experience( do you have)?$|^experience( in years)?$/],
  ['city', /^(current )?(location|city)( city)?$|\bcurrent location\b|\bcity of residence\b|\bwhere are you (located|based)\b/],
];

const AUTOCOMPLETE: Record<string, string> = {
  'given-name': 'first_name',
  'family-name': 'last_name',
  name: 'full_name',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  organization: 'current_company',
  'organization-title': 'current_title',
  'address-level2': 'city',
};

/**
 * Skill-specific experience questions get their own key so an answer for "Python" is never
 * reused for "Node.js": "years of experience with Node.js" -> years_experience_node.js
 */
function skillExperienceKey(n: string): string | null {
  if (!/\byears?\b|\byrs?\b/.test(n) || !/\bexperience\b/.test(n)) return null;
  const m = n.match(/\bexperience\b.*?\b(?:with|in|using|on)\b (.+)$/);
  if (!m?.[1]) return null;
  const skill = tokens(m[1].replace(/\b(in )?years?\b$/, '').trim());
  if (skill.length === 0 || ['total', 'overall'].includes(skill[0] ?? '')) return null;
  return `years_experience_${slug(skill)}`;
}

function canonicalFromText(n: string): string | null {
  if (!n) return null;
  const skill = skillExperienceKey(n);
  if (skill) return skill;
  for (const [key, re] of RULES) if (re.test(n)) return key;
  if (/\b(portfolio|personal website|personal site|website|blog)\b/.test(n) && !/company|employer|organi[sz]ation/.test(n)) {
    return 'portfolio';
  }
  return null;
}

export function keyFor(f: Pick<FieldInfo, 'label' | 'name' | 'id' | 'autocomplete'>): string {
  const ac = f.autocomplete.trim().split(/\s+/).pop() ?? '';
  const fromAc = AUTOCOMPLETE[ac];
  if (fromAc) return fromAc;
  const sources: [string, boolean][] = [[f.label, false], [f.name, true], [f.id, true]];
  for (const [src, camel] of sources) {
    const k = canonicalFromText(normalize(src ?? '', camel));
    if (k) return k;
  }
  // Unknown question: order-insensitive, stopword-free key, so exact repeats match.
  const generic = [...new Set(tokens(f.label || camelSplit(f.name || f.id)))].sort();
  return `q_${slug(generic) || 'unknown'}`;
}

const SENSITIVE_KEY = /(^|_)(password|passwd|pwd|otp|cvv|cvc|card|ssn|aadhaar|aadhar|captcha|csrf|token|secret)(_|$)/;
export const isSensitiveKey = (key: string): boolean => SENSITIVE_KEY.test(key);

export function buildAnswerMap(answers: SavedAnswer[], profile: { fullName?: string; email?: string } = {}): Map<string, string> {
  const map = new Map(answers.filter((a) => a.value.trim()).map((a) => [a.key, a.value.trim()]));
  if (!map.has('full_name') && profile.fullName) map.set('full_name', profile.fullName);
  if (!map.has('email') && profile.email) map.set('email', profile.email);
  const full = map.get('full_name');
  if (full) {
    const parts = full.split(/\s+/);
    if (!map.has('first_name') && parts[0]) map.set('first_name', parts[0]);
    if (!map.has('last_name') && parts.length > 1) map.set('last_name', parts.slice(1).join(' '));
  }
  return map;
}

const YES = new Set(['yes', 'y', 'true']);
const NO = new Set(['no', 'n', 'false']);
const canon = (s: string) => {
  const n = normalize(s);
  return YES.has(n) ? 'yes' : NO.has(n) ? 'no' : n;
};

/** Finds the select/radio option that best matches a saved value, or null (never guesses loosely). */
export function chooseOption(options: FieldOption[], value: string): FieldOption | null {
  const v = canon(value);
  if (!v) return null;
  const real = options.filter((o) => o.text || o.value);
  const exact = real.find((o) => canon(o.text) === v) ?? real.find((o) => canon(o.value) === v);
  if (exact) return exact;
  const vt = new Set(tokens(value));
  if (vt.size === 0) return null;
  return (
    real.find((o) => {
      const ot = new Set(tokens(o.text));
      if (ot.size === 0) return false;
      const [small, big] = vt.size <= ot.size ? [vt, ot] : [ot, vt];
      return [...small].every((t) => big.has(t));
    }) ?? null
  );
}

export type FillPlan = {
  items: FillItem[];
  filled: { label: string; value: string }[];
  needsYou: string[];
};

/** Decides what to fill. Only EMPTY fields are touched; unknown or unmatched fields are reported. */
export function planFill(fields: FieldInfo[], answers: Map<string, string>): FillPlan {
  const plan: FillPlan = { items: [], filled: [], needsYou: [] };
  for (const f of fields) {
    if (!f.empty) continue;
    const label = f.label || f.name || 'Unnamed field';
    const saved = answers.get(keyFor(f));
    if (!saved) {
      plan.needsYou.push(label);
      continue;
    }

    if (f.kind === 'text') {
      let value = saved;
      if (f.type === 'number') {
        const num = saved.match(/\d+(?:\.\d+)?/)?.[0];
        if (!num) {
          plan.needsYou.push(label);
          continue;
        }
        value = num;
      }
      plan.items.push({ ref: f.ref, kind: 'text', value });
      plan.filled.push({ label, value });
    } else {
      const opt = chooseOption(f.options ?? [], saved);
      if (!opt) {
        plan.needsYou.push(label);
        continue;
      }
      if (f.kind === 'select') plan.items.push({ ref: f.ref, kind: 'select', value: opt.value });
      else plan.items.push({ ref: f.ref, kind: 'radio', value: opt.text, optionRef: opt.ref });
      plan.filled.push({ label, value: opt.text });
    }
  }
  return plan;
}

export type Learnable = { key: string; label: string; value: string; long: boolean };

/** Fields the user has filled that can be saved for next time (user reviews before saving). */
export function collectLearnable(fields: FieldInfo[]): Learnable[] {
  const byKey = new Map<string, Learnable>();
  for (const f of fields) {
    const value = f.value.trim();
    if (f.empty || !value || value.length > 2000) continue;
    const key = keyFor(f);
    if (isSensitiveKey(key)) continue;
    byKey.set(key, { key, label: f.label || f.name || key, value, long: f.type === 'textarea' });
  }
  return [...byKey.values()];
}
