import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { commitFile, git } from './helpers/git-repo';

const SKILLS = path.join(__dirname, '..', 'skills');
const SYNC = path.join(SKILLS, 'lantern-sync', 'scripts', 'sync.mjs');
const RECORD = '.lantern/prs/9.pr';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-describe-'));
const repo = path.join(tmp, 'repo');
const DESCRIPTION = {
  what: ['Admins can refund orders.'],
  before: ['Refunds went through support.'],
  after: ['The refund button refunds in one click.', 'The order screen shows the new state.'],
  verified: ['Order tests pass.'],
};

let parseSkill: (text: string, file: string) => { errors: string[]; description: Record<string, string[]> };

function sync(...args: string[]) {
  const run = spawnSync(process.execPath, [SYNC, 'pr', '9', '--url', 'https://x.test/9', '--title', 't', '--base', 'main', '--branch', 'feat/x', '--reason', 'src/a.ts=Adds the module.', ...args], { cwd: repo, encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

const record = () => fs.readFileSync(path.join(repo, RECORD), 'utf8');

function describeFile(name: string, value: unknown) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

beforeAll(async () => {
  parseSkill = (await import(pathToFileURL(path.join(SKILLS, 'lantern-setup', 'scripts', 'prs.mjs')).href)).parsePr;
  fs.mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  commitFile(repo, 'README.md', '# p\n', 'base');
  git(repo, ['checkout', '-q', '-b', 'feat/x']);
  commitFile(repo, 'src/a.ts', 'export const a = 1;\n', 'feat: a');
  fs.mkdirSync(path.join(repo, '.lantern', 'map'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.lantern', 'map', '.lantern'), '');
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sync.mjs pr --describe-file', () => {
  it('writes the description right after the summary and round-trips through both parsers', () => {
    const run = sync('--summary', 'Lead line.', '--describe-file', describeFile('ok.json', DESCRIPTION));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/5 description lines/);
    const text = record();
    const lines = text.split('\n');
    const first = lines.findIndex((l) => l.startsWith('#describe '));
    expect(lines[first - 1]).toBe('#summary Lead line.');
    expect(lines.filter((l) => l.startsWith('#describe '))).toEqual([
      '#describe what Admins can refund orders.',
      '#describe before Refunds went through support.',
      '#describe after The refund button refunds in one click.',
      '#describe after The order screen shows the new state.',
      '#describe verified Order tests pass.',
    ]);
    expect(lines.indexOf('+ src/a.ts')).toBeGreaterThan(first);
    const skill = parseSkill(text, RECORD);
    expect(skill.errors).toEqual([]);
    expect(skill.description).toEqual(DESCRIPTION);
    expect(parsePrRecord(text, '9.pr').pr?.description).toEqual(DESCRIPTION);
  });

  it('keeps the description on a re-run without the flag', () => {
    const before = record();
    const run = sync('--summary', 'Lead line.');
    expect(run.status, run.stderr).toBe(0);
    expect(record()).toBe(before);
  });

  it('replaces it with a new file and clears it with an empty object', () => {
    expect(sync('--summary', 'Lead line.', '--describe-file', describeFile('one.json', { what: ['Only this.'] })).status).toBe(0);
    expect(parseSkill(record(), RECORD).description).toEqual({ what: ['Only this.'] });
    expect(sync('--summary', 'Lead line.', '--describe-file', describeFile('empty.json', {})).status).toBe(0);
    expect(record()).not.toContain('#describe');
  });

  it.each([
    ['an unknown key', { bogus: ['x'] }, /unknown section "bogus"/],
    ['a section that is not an array', { what: 'text' }, /"what" must be an array of strings/],
    ['a non-string entry', { what: [1] }, /"what" must be an array of strings/],
    ['an empty entry', { what: [' '] }, /text is empty/],
    ['a line over 400 characters', { what: ['x'.repeat(401)] }, /cap is 400/],
    ['nine lines in a section', { what: Array.from({ length: 9 }, (_, i) => `line ${i}`) }, /more than 8 #describe what lines/],
    ['a comment marker', { what: ['<!-- note --> hi'] }, /<!-- --> marker/],
    ['the cost block', { what: ['delegate:cost'] }, /delegate:cost block/],
    ['a table row', { what: ['| agent | model |'] }, /table row/],
    ['a control character', { what: ['bad\u0001char'] }, /control character/],
    ['an array instead of an object', ['x'], /JSON object/],
  ])('refuses %s with exit 2 and leaves the record alone', (_label, value, pattern) => {
    const before = record();
    const run = sync('--summary', 'Lead line.', '--describe-file', describeFile('bad.json', value));
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(pattern);
    expect(record()).toBe(before);
  });

  it('refuses a file that is not JSON and one that does not exist', () => {
    const before = record();
    expect(sync('--describe-file', describeFile('junk.json', '{nope')).status).toBe(2);
    expect(sync('--describe-file', path.join(tmp, 'missing.json')).status).toBe(2);
    expect(record()).toBe(before);
  });

  it('folds whitespace in an entry to single spaces', () => {
    expect(sync('--summary', 'Lead line.', '--describe-file', describeFile('fold.json', { what: ['two\n  lines   here'] })).status).toBe(0);
    expect(parseSkill(record(), RECORD).description).toEqual({ what: ['two lines here'] });
  });
});
