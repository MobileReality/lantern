import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { message } from '../skills/lantern-delegate/scripts/messages.mjs';

const SCRIPTS = path.resolve(__dirname, '../skills/lantern-delegate/scripts');
const table = JSON.parse(readFileSync(path.join(SCRIPTS, 'messages.json'), 'utf8'));
const CALL = /\bmessage\(\s*'([\w.]+)'/g;
const LITERAL_KEY = /'((?:git|hostSkill|preflight|prCreate|appendCost|preferences|extensions|identity|skillLinker)\.[\w.]+)'/g;

function scriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scriptFiles(full);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

const valueAt = (key: string): unknown => key.split('.').reduce<unknown>((at, part) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined), table);

const leaves = (node: unknown, prefix: string): string[] =>
  typeof node === 'string' ? [prefix] : Object.entries(node as object).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));

describe('the delegate skill messages', () => {
  it('fills placeholders and leaves the ones it has no value for', () => {
    expect(message('preflight.githubCredentials', { source: 'Lantern', login: 'octo' })).toBe('GITHUB_TOKEN resolves (from Lantern), authenticated as octo');
    expect(message('preflight.githubCredentials', { source: 'Lantern' })).toBe('GITHUB_TOKEN resolves (from Lantern), authenticated as {login}');
  });

  it('returns the key for a message that does not exist, so the gap shows', () => {
    expect(message('preflight.nothing')).toBe('preflight.nothing');
    expect(message('preflight')).toBe('preflight');
  });

  it('has every message the scripts ask for', () => {
    const calls = scriptFiles(SCRIPTS).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(CALL)].map((match) => ({ file: path.basename(file), key: match[1] })));
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const { file, key } of calls) expect(typeof valueAt(key), `${file}: ${key}`).toBe('string');
  });

  it('has no message that no script uses', () => {
    const used = new Set(scriptFiles(SCRIPTS).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(LITERAL_KEY)].map((match) => match[1])));
    expect(leaves(table, '').filter((key) => !used.has(key))).toEqual([]);
  });
});
