import { load } from 'js-yaml';

export interface ExplainFileRef {
  path: string;
  symbol?: string;
  note?: string;
}

export interface ExplainMeta {
  title: string;
  summary: string;
  slug: string;
  created?: string;
  base?: string;
  files: ExplainFileRef[];
}

export interface QuizOption {
  text: string;
  correct: boolean;
  why: string;
}

export interface QuizQuestion {
  q: string;
  options: QuizOption[];
}

export interface Explain {
  meta: ExplainMeta;
  primer: string;
  context: string;
  intuition: string;
  code: string;
  quiz: QuizQuestion[];
  error?: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const QUIZ_FENCE = /```quiz\s*\n([\s\S]*?)```/;

function splitFrontmatter(text: string): { front: string; body: string } {
  const m = text.match(FRONTMATTER);
  if (!m) return { front: '', body: text };
  return { front: m[1], body: text.slice(m[0].length) };
}

// Walk markdown lines, tracking fenced code blocks (``` / ~~~) so a heading-like
// line inside a fence is reported as content, never as a heading.
function eachLine(text: string, cb: (line: string, inFence: boolean) => void) {
  let fence = '';
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (line.trimStart().startsWith(fence)) fence = '';
      cb(line, true);
      continue;
    }
    cb(line, !!fence);
  }
}

// Split a markdown body into its `## ` sections. `### ` and deeper headings stay
// inside their parent section's content.
function topSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current = '';
  let buf: string[] = [];
  const flush = () => {
    if (current) out[current] = buf.join('\n').trim();
  };
  eachLine(body, (line, inFence) => {
    const h = inFence ? null : line.match(/^##\s+(.+?)\s*$/);
    if (h && !line.startsWith('###')) {
      flush();
      current = h[1].toLowerCase();
      buf = [];
    } else {
      buf.push(line);
    }
  });
  flush();
  return out;
}

function subSection(content: string, name: string): string {
  const want = name.toLowerCase();
  let current = '';
  let buf: string[] = [];
  const found: Record<string, string> = {};
  const flush = () => {
    if (current) found[current] = buf.join('\n').trim();
  };
  eachLine(content, (line, inFence) => {
    const h = inFence ? null : line.match(/^###\s+(.+?)\s*$/);
    if (h) {
      flush();
      current = h[1].toLowerCase();
      buf = [];
    } else {
      buf.push(line);
    }
  });
  flush();
  return found[want] || '';
}

function toFileRefs(raw: unknown): ExplainFileRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      path: String(f.path ?? ''),
      symbol: f.symbol == null ? undefined : String(f.symbol),
      note: f.note == null ? undefined : String(f.note),
    }))
    .filter((f) => f.path);
}

function toMeta(front: unknown): ExplainMeta {
  const f = (front && typeof front === 'object' ? front : {}) as Record<string, unknown>;
  return {
    title: String(f.title ?? ''),
    summary: String(f.summary ?? ''),
    slug: String(f.slug ?? ''),
    created: f.created == null ? undefined : String(f.created),
    base: f.base == null ? undefined : String(f.base),
    files: toFileRefs(f.files),
  };
}

export function parseQuiz(section: string): QuizQuestion[] {
  const m = section.match(QUIZ_FENCE);
  if (!m) return [];
  let doc: unknown;
  try {
    doc = load(m[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(doc)) return [];
  return doc
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && Array.isArray((q as any).options))
    .map((q) => ({
      q: String(q.q ?? ''),
      options: (q.options as unknown[])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .map((o) => ({ text: String(o.text ?? ''), correct: o.correct === true, why: String(o.why ?? '') }))
        .filter((o) => o.text),
    }))
    .filter((q) => q.q && q.options.length);
}

export function parseExplain(text: string): Explain {
  const { front, body } = splitFrontmatter(text);
  let meta: ExplainMeta;
  try {
    meta = toMeta(load(front || '{}'));
  } catch {
    return blank('Could not parse the explainer frontmatter.');
  }
  if (!meta.title && !meta.summary) return blank('This file is missing its explainer frontmatter.');

  const sections = topSections(body);
  const background = sections.background || '';
  return {
    meta,
    primer: subSection(background, 'primer'),
    context: subSection(background, 'context'),
    intuition: sections.intuition || '',
    code: sections.code || '',
    quiz: parseQuiz(sections.quiz || ''),
  };
}

function blank(error: string): Explain {
  return {
    meta: { title: '', summary: '', slug: '', files: [] },
    primer: '',
    context: '',
    intuition: '',
    code: '',
    quiz: [],
    error,
  };
}
