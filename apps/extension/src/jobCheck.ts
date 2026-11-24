export type JobCheck = { isJob: boolean; reason: string };

const JOB_TERMS = [
  'responsibilities', 'requirements', 'qualifications', 'experience', 'skills', 'years',
  'job description', 'about the role', 'about the job', "what you'll", 'you will', 'we are looking',
  'benefits', 'salary', 'full-time', 'full time', 'remote', 'preferred', 'bachelor', 'proficiency',
  'knowledge of', 'ability to', 'team', 'role', 'position', 'apply',
];

/** Patterns that repeat once per card on search-result / listing pages. */
const LISTING_PATTERNS = [
  /\b\d+\s+(?:minutes?|hours?|days?|weeks?|months?)\s+ago\b/g,
  /\beasy apply\b/g,
  /\bapplicants?\b/g,
  /\bpromoted\b/g,
  /\bviewed\b/g,
  /\bactively (?:recruiting|hiring)\b/g,
  /\b\d+\+?\s+results\b/g,
  /\bjobs? (?:based on|picked for|for you)\b/g,
];

/** Heuristic only: it warns, it never blocks. */
export function checkJobText(text: string): JobCheck {
  const t = text.toLowerCase();
  if (t.trim().length < 200) return { isJob: false, reason: 'The text is very short for a job description.' };

  const listingHits = LISTING_PATTERNS.reduce((n, re) => n + (t.match(re)?.length ?? 0), 0);
  if (listingHits >= 5) {
    return { isJob: false, reason: 'This looks like a list of jobs. Open one job and select its description text.' };
  }

  const termHits = JOB_TERMS.filter((term) => t.includes(term)).length;
  if (termHits < 4) {
    return { isJob: false, reason: "This doesn't look like a job description. Select the description text on the page." };
  }
  return { isJob: true, reason: '' };
}
