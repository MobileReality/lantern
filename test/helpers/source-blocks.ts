export interface SourceRange {
  start: number;
  end: number;
  text: string;
}

const CLOSERS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };

function balancedFrom(source: string, open: number): SourceRange {
  const opener = source[open];
  const closer = CLOSERS[opener];
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === opener) depth++;
    else if (source[i] === closer && --depth === 0) return { start: open, end: i + 1, text: source.slice(open, i + 1) };
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
