import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@shared/lang/en/messages.json';
import { createMessages, msg, msgCount, msgList } from '@shared/lang/messages';

const root = path.resolve(__dirname, '..');
const SOURCE_FOLDER = path.join(root, 'src');
const CALL = /\b(msg|msgList|msgCount)\(\s*(?:'([\w.-]+)'|"([\w.-]+)"|`([\w.-]+)`)/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [full] : [];
  });
}

function valueAt(key: string): unknown {
  return key.split('.').reduce<unknown>((at, part) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined), en);
}

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (Array.isArray(node)) return node.map((item, index) => [`${prefix}[${index}]`, item] as [string, string]);
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

describe('the messages accessor', () => {
  const tables = { en: { greet: 'Hello {name}', only: 'Only English', list: ['a {x}', 'b'], days: { one: '{count} day', other: '{count} days' } }, pl: { greet: 'Czesc {name}' } };
  const english = createMessages(tables);
  const polish = createMessages(tables, 'pl-PL');

  it('fills named placeholders with strings and numbers', () => {
    expect(english.msg('greet' as never, { name: 'Ada' })).toBe('Hello Ada');
    expect(english.msg('greet' as never, { name: 3 })).toBe('Hello 3');
  });

  it('leaves a placeholder it was not given a value for', () => {
    expect(english.msg('greet' as never)).toBe('Hello {name}');
    expect(english.msg('greet' as never, { other: 'x' })).toBe('Hello {name}');
  });

  it('answers in the language asked for, matching the code by its first part', () => {
    expect(polish.msg('greet' as never, { name: 'Ada' })).toBe('Czesc Ada');
  });

  it('falls back to English for a key the language lacks', () => {
    expect(polish.msg('only' as never)).toBe('Only English');
  });

  it('falls back to English for a language it has no table for', () => {
    expect(createMessages(tables, 'xx').msg('greet' as never, { name: 'Ada' })).toBe('Hello Ada');
    expect(createMessages(tables, undefined).msg('only' as never)).toBe('Only English');
  });

  it('returns the key itself when no language has it, so the gap shows on screen', () => {
    expect(english.msg('nowhere.at.all' as never)).toBe('nowhere.at.all');
  });

  it('returns a list with its items filled, and an empty list for a missing one', () => {
    expect(english.msgList('list' as never, { x: '1' })).toEqual(['a 1', 'b']);
    expect(english.msgList('missing' as never)).toEqual([]);
    expect(english.msgList('only' as never)).toEqual([]);
  });

  it('picks the singular for one and the plural for everything else, with the count filled in', () => {
    expect(english.msgCount('days' as never, 1)).toBe('1 day');
    expect(english.msgCount('days' as never, 0)).toBe('0 days');
    expect(english.msgCount('days' as never, 14)).toBe('14 days');
  });

  it('reads the bundled English catalogue by default', () => {
    expect(msg('auth.storageFailed')).toBe(en.auth.storageFailed);
    expect(msgList('integrations.help.github.steps')).toEqual(en.integrations.help.github.steps);
    expect(msgCount('counts.accounts', 2)).toBe('2 accounts');
  });
});

describe('the English catalogue', () => {
  const entries = leaves(en);

  it('has only non-empty strings', () => {
    for (const [key, value] of entries) expect(value.trim(), key).not.toBe('');
  });

  it('writes every placeholder as a plain word', () => {
    for (const [key, value] of entries) expect(value.replace(/\{\w+\}/g, ''), key).not.toMatch(/[{}]/);
  });

  it('gives every plural both forms', () => {
    const bases = new Set(entries.flatMap(([key]) => (/\.(one|other)$/.test(key) ? [key.replace(/\.(one|other)$/, '')] : [])));
    for (const base of bases) {
      expect(valueAt(`${base}.one`), base).toEqual(expect.any(String));
      expect(valueAt(`${base}.other`), base).toEqual(expect.any(String));
    }
  });
});

describe('every message the source asks for by name', () => {
  const calls = walk(SOURCE_FOLDER).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(CALL)].map((match) => ({ file: path.relative(root, file), fn: match[1], key: match[2] ?? match[3] ?? match[4] }));
  });

  it('finds the calls to check', () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it('exists in the catalogue', () => {
    for (const { file, fn, key } of calls) {
      const paths = fn === 'msgCount' ? [`${key}.one`, `${key}.other`] : [key];
      for (const at of paths) {
        const value = valueAt(at);
        expect(fn === 'msgList' ? Array.isArray(value) : typeof value === 'string', `${file}: ${fn}('${key}')`).toBe(true);
      }
    }
  });
});
