const EXPLAINER_ENABLED = false;

const PR_EXPLAIN_START = 'prexplain:start';
const PR_EXPLAIN_CANCEL = 'prexplain:cancel';
const PR_EXPLAIN_SAVED = 'prexplain:saved';
const PR_EXPLAIN_DONE = 'prexplain:done';

const PR_ID_PATTERN = /^\d{1,12}$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;
const PR_EXPLAIN_MAX_PATH = 1024;

interface PrExplainTarget {
  project: string;
  pr: string;
  path: string;
}

interface PrExplainSections {
  summary: string;
  before: string;
  after: string;
  example: string;
}

interface PrExplanation {
  text: string;
  sections?: PrExplainSections;
  head: string;
  at: number;
  stale: boolean;
}

type PrExplainStartResult = { ok: true } | { ok: false; error: string; busy?: boolean };

type PrExplainSavedResult = { ok: true; explanation: PrExplanation | null } | { ok: false; error: string };

type PrExplainDone = PrExplainTarget & ({ ok: true; explanation: PrExplanation } | { ok: false; cancelled: boolean; error: string });

function isPrExplanationStale(savedHead: string, currentHead: string) {
  return savedHead !== currentHead;
}

const PR_EXPLAIN_NEW_FILE_BEFORE = 'This file is new.';

const SECTION_HEADINGS: ReadonlyArray<readonly [keyof PrExplainSections, string]> = [
  ['summary', 'What changes'],
  ['before', 'Before'],
  ['after', 'After'],
  ['example', 'Example'],
];

function explanationPlainText(sections: PrExplainSections) {
  return SECTION_HEADINGS.filter(([key]) => sections[key])
    .map(([key, heading]) => `${heading}\n${sections[key]}`)
    .join('\n\n');
}

export { COMMIT_PATTERN, EXPLAINER_ENABLED, PR_EXPLAIN_CANCEL, PR_EXPLAIN_DONE, PR_EXPLAIN_MAX_PATH, PR_EXPLAIN_NEW_FILE_BEFORE, PR_EXPLAIN_SAVED, PR_EXPLAIN_START, PR_ID_PATTERN, SECTION_HEADINGS, explanationPlainText, isPrExplanationStale };
export type { PrExplainDone, PrExplainSavedResult, PrExplainSections, PrExplainStartResult, PrExplainTarget, PrExplanation };
