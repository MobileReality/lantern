import { clip, type DiagnosticEntry } from '../../shared/diagnostics';
import { redactText } from './redact';
import { environmentLines, formatReport, summarizeEntries, type ReportContext } from './report';

const ISSUE_ORIGIN = 'https://github.com';
const ISSUE_PATH = '/MobileReality/lantern/issues/new';
const ISSUE_TEMPLATE = 'bug_report.md';
const ISSUE_LABEL = 'bug';
export const MAX_ISSUE_URL_CHARS = 6000;
const MAX_TITLE_CHARS = 120;
const TITLE_PREFIX = '[Bug] ';
const FENCE = '```';
const CLIPBOARD_NOTE = 'The full report is too long for a link. It was copied to your clipboard: paste it here before you submit.';

export interface IssueDraft {
  title: string;
  summary: string;
  full: string;
}

export interface IssuePlan {
  url: string;
  truncated: boolean;
  clipboard: string | null;
}

export function buildIssueUrl(title: string, body: string): string {
  const query = [
    ['template', ISSUE_TEMPLATE],
    ['labels', ISSUE_LABEL],
    ['title', title],
    ['body', body],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${ISSUE_ORIGIN}${ISSUE_PATH}?${query}`;
}

export function isIssueUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === ISSUE_ORIGIN && url.pathname === ISSUE_PATH && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function issueBody(lead: string, environment: string[], report: string): string {
  return [
    '## What happened',
    lead,
    '',
    '## Environment',
    ...environment.map((line) => `- ${line}`),
    '',
    '## Diagnostics',
    FENCE,
    report,
    FENCE,
  ].join('\n');
}

export function planIssue(draft: IssueDraft, environment: string[]): IssuePlan {
  const title = clip(draft.title, MAX_TITLE_CHARS);
  const lead = 'Sent from the Diagnostics view. Describe what you were doing when it happened.';
  const whole = buildIssueUrl(title, issueBody(lead, environment, draft.full));
  if (whole.length <= MAX_ISSUE_URL_CHARS) return { url: whole, truncated: false, clipboard: null };
  const short = (summary: string) => buildIssueUrl(title, issueBody(`${lead}\n\n${CLIPBOARD_NOTE}`, environment, summary));
  let summary = draft.summary;
  let url = short(summary);
  while (url.length > MAX_ISSUE_URL_CHARS && summary.length > 0) {
    summary = summary.slice(0, Math.floor(summary.length * 0.8));
    url = short(summary);
  }
  return { url, truncated: true, clipboard: draft.full };
}

function titleFor(entries: DiagnosticEntry[], crash: boolean, context: ReportContext): string {
  if (crash) return `${TITLE_PREFIX}Lantern closed unexpectedly`;
  const subject = entries.at(-1);
  return redactText(subject ? `${TITLE_PREFIX}${subject.message}`.replace(/\s+/g, ' ') : `${TITLE_PREFIX}Lantern diagnostics`, context);
}

export function composeIssue(entries: DiagnosticEntry[], context: ReportContext, crash = false): { draft: IssueDraft; environment: string[] } {
  return {
    draft: {
      title: titleFor(entries, crash, context),
      summary: summarizeEntries(entries, context),
      full: formatReport(entries, context),
    },
    environment: environmentLines(context).map((line) => redactText(line, context)),
  };
}
