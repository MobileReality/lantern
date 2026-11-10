import GithubSlugger from 'github-slugger';
import { withoutTags } from './tags';

export type Heading = { level: number; text: string; id: string };

const FENCE = /^\s*(```|~~~)/;
const ATX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HTML_HEADING = /^<h([1-6])[^>]*>(.*)<\/h\1>\s*$/;
const FIRST_TOC_LEVEL = 2;
const LAST_TOC_LEVEL = 3;

function plainText(markup: string): string {
  return withoutTags(markup.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'))
    .replace(/[`*_]/g, '')
    .trim();
}

function parseHeadingLine(line: string): { level: number; markup: string } | null {
  const atx = ATX.exec(line);
  if (atx) return { level: atx[1].length, markup: atx[2] };
  const html = HTML_HEADING.exec(line);
  if (html) return { level: Number(html[1]), markup: html[2] };
  return null;
}

export function extractHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const parsed = parseHeadingLine(line);
    if (!parsed) continue;
    const text = plainText(parsed.markup);
    headings.push({ level: parsed.level, text, id: slugger.slug(text) });
  }
  return headings;
}

export function tocHeadings(markdown: string): Heading[] {
  return extractHeadings(markdown).filter((heading) => heading.level >= FIRST_TOC_LEVEL && heading.level <= LAST_TOC_LEVEL);
}
