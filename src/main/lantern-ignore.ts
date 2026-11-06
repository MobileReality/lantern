import fs from 'node:fs';

interface IgnoreRule {
  base: string;
  regex: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

const escapeChar = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function classEnd(glob: string, open: number) {
  let j = open + 1;
  if (glob[j] === '!') j += 1;
  if (glob[j] === ']') j += 1;
  return glob.indexOf(']', j);
}

function globToRegex(glob: string) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        const next = glob[i + 2];
        if (atSegmentStart && next === '/') {
          re += '(?:.*/)?';
          i += 2;
          continue;
        }
        if (atSegmentStart && next === undefined) {
          re += '.*';
          i += 1;
          continue;
        }
        re += '[^/]*';
        i += 1;
        continue;
      }
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '[') {
      const close = classEnd(glob, i);
      if (close === -1) {
        re += '\\[';
      } else {
        let body = glob.slice(i + 1, close);
        const negated = body.startsWith('!');
        if (negated) body = body.slice(1);
        re += `[${negated ? '^' : ''}${body.replace(/[\\\]\[^]/g, '\\$&')}]`;
        i = close;
      }
    } else if (ch === '\\' && i + 1 < glob.length) {
      re += escapeChar(glob[i + 1]);
      i += 1;
    } else {
      re += escapeChar(ch);
    }
  }
  return re;
}

function parseIgnore(text: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const body = globToRegex(line);
    rules.push({ base, regex: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`), negate, dirOnly });
  }
  return rules;
}

function ruleMatches(rule: IgnoreRule, rel: string, isDir: boolean) {
  if (rule.dirOnly && !isDir) return false;
  let local = rel;
  if (rule.base) {
    if (!rel.startsWith(`${rule.base}/`)) return false;
    local = rel.slice(rule.base.length + 1);
  }
  return rule.regex.test(local);
}

function isIgnored(rules: IgnoreRule[], rel: string, isDir: boolean) {
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatches(rule, rel, isDir)) ignored = !rule.negate;
  }
  return ignored;
}

function isIncluded(rules: IgnoreRule[], rel: string) {
  const segments = rel.split('/');
  const folders = segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
  let included = false;
  for (const rule of rules) {
    if (ruleMatches(rule, rel, false) || folders.some((folder) => ruleMatches(rule, folder, true))) included = !rule.negate;
  }
  return included;
}

async function readIgnoreFile(file: string, base: string): Promise<IgnoreRule[]> {
  try {
    return parseIgnore(await fs.promises.readFile(file, 'utf8'), base);
  } catch {
    return [];
  }
}

export { parseIgnore, isIgnored, isIncluded, readIgnoreFile };
export type { IgnoreRule };
