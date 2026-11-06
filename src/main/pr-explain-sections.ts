import { PR_EXPLAIN_NEW_FILE_BEFORE, SECTION_HEADINGS, explanationPlainText } from '../shared/pr-explain';
import type { PrExplainSections } from '../shared/pr-explain';
import { PR_EXPLAIN_MAX_REPLY_CHARS, cleanExplanation } from './pr-explain-prompt';

const PR_EXPLAIN_MAX_SECTION_CHARS = 700;
const FENCE = /^```[a-z]*\s*\n?|\n?```\s*$/gi;

interface ResolvedExplanation {
  text: string;
  sections?: PrExplainSections;
}

function jsonObjectIn(reply: string): Record<string, unknown> | null {
  const unfenced = reply.trim().replace(FENCE, '').trim();
  const open = unfenced.indexOf('{');
  const close = unfenced.lastIndexOf('}');
  if (open < 0 || close < open) return null;
  try {
    const parsed: unknown = JSON.parse(unfenced.slice(open, close + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sectionText(value: unknown) {
  return typeof value === 'string' ? cleanExplanation(value, PR_EXPLAIN_MAX_SECTION_CHARS) : '';
}

function plainFallback(reply: string, object: Record<string, unknown> | null): ResolvedExplanation {
  const present = object ? SECTION_HEADINGS.map(([key, heading]) => [heading, sectionText(object[key])] as const).filter(([, value]) => value) : [];
  if (!present.length) return { text: cleanExplanation(reply, PR_EXPLAIN_MAX_REPLY_CHARS) };
  return { text: present.map(([heading, value]) => `${heading}\n${value}`).join('\n\n') };
}

function resolveExplanation(reply: string, isNewFile: boolean): ResolvedExplanation {
  const object = jsonObjectIn(reply);
  const complete = !!object && SECTION_HEADINGS.every(([key]) => typeof object[key] === 'string');
  if (!complete) return plainFallback(reply, object);
  const sections: PrExplainSections = {
    summary: sectionText(object.summary),
    before: sectionText(object.before),
    after: sectionText(object.after),
    example: sectionText(object.example),
  };
  if (isNewFile && !sections.before) sections.before = PR_EXPLAIN_NEW_FILE_BEFORE;
  if (!sections.summary || !sections.after) return plainFallback(reply, object);
  return { text: explanationPlainText(sections), sections };
}

export { PR_EXPLAIN_MAX_SECTION_CHARS, resolveExplanation };
export type { ResolvedExplanation };
