export interface SourceRange {
  start: number;
  end: number;
  text: string;
}

const CLOSERS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
  return i + 1;
}

function skipTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length && source[i] !== '`') {
    if (source[i] === '\\') i += 2;
    else if (source[i] === '$' && source[i + 1] === '{') i = skipTemplateExpression(source, i + 2);
    else i++;
  }
  return i + 1;
}

function skipTemplateExpression(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const next = skipLiteral(source, i);
    if (next !== i) i = next;
    else {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) return i + 1;
      i++;
    }
  }
  return i;
}

function skipLiteral(source: string, i: number): number {
  const char = source[i];
  if (char === "'" || char === '"') return skipQuoted(source, i, char);
  if (char === '`') return skipTemplate(source, i);
  if (char === '/' && source[i + 1] === '/') {
    const end = source.indexOf('\n', i);
    return end < 0 ? source.length : end + 1;
  }
  if (char === '/' && source[i + 1] === '*') {
    const end = source.indexOf('*/', i + 2);
    return end < 0 ? source.length : end + 2;
  }
  return i;
}

function balancedFrom(source: string, open: number): SourceRange {
  const opener = source[open];
  const closer = CLOSERS[opener];
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const next = skipLiteral(source, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (source[i] === opener) depth++;
    else if (source[i] === closer && --depth === 0) return { start: open, end: i + 1, text: source.slice(open, i + 1) };
    i++;
  }
  throw new Error(`unbalanced ${opener} at ${open}`);
}

export function functionBody(source: string, name: string): SourceRange {
  const at = source.search(new RegExp(`function ${name}\\(`));
  if (at < 0) throw new Error(`function ${name} not found`);
  const params = balancedFrom(source, source.indexOf('(', at));
  return balancedFrom(source, source.indexOf('{', params.end));
}

export function callArguments(source: string, callee: string): SourceRange {
  const at = source.indexOf(`${callee}(`);
  if (at < 0) throw new Error(`${callee}( not found`);
  return balancedFrom(source, at + callee.length);
}

export function ipcHandler(source: string, channel: string): SourceRange {
  const at = source.search(new RegExp(`ipcMain\\.handle\\(\\s*'${channel}'`));
  if (at < 0) throw new Error(`no ipcMain.handle for ${channel}`);
  return balancedFrom(source, source.indexOf('(', at));
}

export function occurrences(source: string, needle: string | RegExp): number[] {
  const pattern = typeof needle === 'string' ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(needle.source, 'g');
  return [...source.matchAll(pattern)].map((m) => m.index ?? 0);
}

export const within = (index: number, range: SourceRange) => index >= range.start && index < range.end;
