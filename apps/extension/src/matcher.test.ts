import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldInfo } from './formScan';
import { buildAnswerMap, chooseOption, collectLearnable, keyFor, planFill } from './matcher';

const f = (label: string, extra: Partial<FieldInfo> = {}): FieldInfo => ({
  ref: `r-${label}`, kind: 'text', label, name: '', id: '', autocomplete: '', type: 'text', value: '', empty: true, ...extra,
});
const key = (label: string, extra: Partial<FieldInfo> = {}) => keyFor(f(label, extra));

describe('keyFor: common fields', () => {
  it('maps typical labels to canonical keys', () => {
    assert.equal(key('First name'), 'first_name');
    assert.equal(key('Last name *'), 'last_name');
    assert.equal(key('Email address'), 'email');
    assert.equal(key('Mobile phone number'), 'phone');
    assert.equal(key('Phone country code'), 'phone_country_code');
    assert.equal(key('LinkedIn Profile URL'), 'linkedin');
    assert.equal(key('Notice period (in days)'), 'notice_period');
    assert.equal(key('Expected CTC'), 'expected_ctc');
    assert.equal(key('Current CTC (LPA)'), 'current_ctc');
    assert.equal(key('Current company'), 'current_company');
    assert.equal(key('Location (city)'), 'city');
    assert.equal(key('Full name'), 'full_name');
  });

  it('does not treat "company name" or "company website" as the person', () => {
    assert.notEqual(key('Company name'), 'full_name');
    assert.notEqual(key('Company website'), 'portfolio');
  });

  it('uses autocomplete and camelCase names when the label is missing', () => {
    assert.equal(keyFor({ label: '', name: 'x', id: 'y', autocomplete: 'given-name' }), 'first_name');
    assert.equal(keyFor({ label: '', name: 'lastName', id: '', autocomplete: '' }), 'last_name');
  });
});

describe('keyFor: Easy Apply general questions', () => {
  it('total experience vs skill-specific experience', () => {
    assert.equal(key('How many years of work experience do you have?'), 'total_experience');
    assert.equal(key('How many years of work experience do you have with Node.js?'), 'years_experience_node.js');
    assert.equal(key('How many years of experience do you have in Python?'), 'years_experience_python');
    assert.equal(key('Years of experience with PostgreSQL (in years)'), 'years_experience_postgresql');
  });

  it('never reuses one skill\'s answer for another skill', () => {
    assert.notEqual(
      key('How many years of work experience do you have with Node.js?'),
      key('How many years of work experience do you have with Python?'),
    );
  });

  it('gives the same key to the same unknown question, regardless of word order/stopwords', () => {
    assert.equal(
      key('Are you comfortable commuting to this job\'s location?'),
      key("Are you comfortable commuting to this job's location"),
    );
    assert.notEqual(key('Are you willing to relocate?'), key('Are you comfortable commuting?'));
  });
});

describe('chooseOption', () => {
  const opts = (...t: string[]) => t.map((text, i) => ({ text, value: String(i), ref: `o${i}` }));

  it('matches yes/no synonyms and exact text', () => {
    assert.equal(chooseOption(opts('Yes', 'No'), 'yes')?.text, 'Yes');
    assert.equal(chooseOption(opts('Yes', 'No'), 'N')?.text, 'No');
    assert.equal(chooseOption(opts('India (+91)', 'United States (+1)'), 'India (+91)')?.text, 'India (+91)');
  });

  it('matches by contained words but never guesses', () => {
    assert.equal(chooseOption(opts('30 days', '60 days', '90 days'), '60 days')?.text, '60 days');
    assert.equal(chooseOption(opts('Immediate', '15 days'), '45 days'), null);
  });
});

describe('planFill', () => {
  const answers = buildAnswerMap(
    [
      { key: 'email', label: 'Email', value: 'a@b.co' },
      { key: 'notice_period', label: 'Notice', value: '30 days' },
      { key: 'total_experience', label: 'Exp', value: '3 years' },
    ],
    { fullName: 'Asha Verma' },
  );

  it('fills only empty fields and reports the rest as needing the user', () => {
    const fields = [
      f('Email address'),
      f('First name'),
      f('Last name', { value: 'Already', empty: false }),
      f('Why do you want to join us?'),
    ];
    const plan = planFill(fields, answers);
    assert.deepEqual(plan.items.map((i) => i.value), ['a@b.co', 'Asha']);
    assert.deepEqual(plan.needsYou, ['Why do you want to join us?']);
  });

  it('extracts the number for numeric inputs', () => {
    const plan = planFill([f('Total years of experience', { type: 'number' })], answers);
    assert.equal(plan.items[0]?.value, '3');
  });

  it('fills selects and radios via options, and reports unmatched options', () => {
    const sel = f('Notice period', {
      kind: 'select', type: 'select-one', options: [{ text: '15 days', value: 'a', ref: '' }, { text: '30 days', value: 'b', ref: '' }],
    });
    const radio = f('Are you comfortable commuting?', {
      kind: 'radio', type: 'radio', options: [{ text: 'Yes', value: 'y', ref: 'R1' }, { text: 'No', value: 'n', ref: 'R2' }],
    });
    const plan = planFill([sel, radio], buildAnswerMap([
      { key: 'notice_period', label: 'n', value: '30 days' },
      { key: keyFor(radio), label: 'c', value: 'Yes' },
    ]));
    assert.deepEqual(plan.items.map((i) => [i.kind, i.value, i.optionRef]), [['select', 'b', undefined], ['radio', 'Yes', 'R1']]);

    const miss = planFill([sel], buildAnswerMap([{ key: 'notice_period', label: 'n', value: '90 days' }]));
    assert.deepEqual(miss.needsYou, ['Notice period']);
  });
});

describe('collectLearnable', () => {
  it('collects filled fields, skips empty and sensitive ones', () => {
    const out = collectLearnable([
      f('Email', { value: 'a@b.co', empty: false }),
      f('Empty one'),
      f('Password hint', { value: 'x', empty: false, name: 'password' }),
      f('Cover letter', { value: 'Hello…', empty: false, type: 'textarea' }),
    ]);
    assert.deepEqual(out.map((o) => o.key), ['email', 'q_cover_letter']);
    assert.equal(out[1]?.long, true);
  });
});
