import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as explains from '../src/main/explains';
import { lanternStamp } from '../src/main/lantern-stamp';
import { commitFile, git, write } from './helpers/git-repo';

const LEGACY = ['.mr', 'code', 'helper'].join('-');

let project: string;
const data = (rel: string) => path.join(project, '.lantern', '.project', rel);

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-stores-'));
  git(project, ['init', '-q', '-b', 'main']);
  commitFile(project, 'src/app.ts', 'export const a = 1;\n', 'init');
  write(project, 'src/app.ts', 'export const a = 2;\n');
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe('explains store', () => {
  it('lists, and removes, explainers under .lantern/.project/explains', () => {
    write(project, '.lantern/.project/explains/one.md', 'ONE');
    write(project, '.lantern/.project/explains/two.md', 'TWO');
    expect(explains.list(project).map((f) => f.name).sort()).toEqual(['one.md', 'two.md']);
    expect(explains.remove(project, 'one.md').map((f) => f.name)).toEqual(['two.md']);
    expect(fs.existsSync(data('explains/one.md'))).toBe(false);
  });

  it('lists the explainers of a project that still has the old folder', () => {
    write(project, `${LEGACY}/explains/old.md`, 'OLD');
    expect(explains.list(project).map((f) => f.name)).toEqual(['old.md']);
    expect(fs.readFileSync(data('explains/old.md'), 'utf8')).toBe('OLD');
    expect(fs.existsSync(path.join(project, LEGACY))).toBe(false);
  });
});

describe('lantern stamp', () => {
  it('does not move when only the project-local data changes', async () => {
    write(project, '.lantern/map/src.lantern', 'lantern 1');
    const before = await lanternStamp(project);
    write(project, '.lantern/.project/review.json', '{}');
    write(project, '.lantern/.project/explains/a.md', 'A');
    expect(await lanternStamp(project)).toBe(before);
    write(project, '.lantern/map/src.lantern', 'lantern 1 changed');
    expect(await lanternStamp(project)).not.toBe(before);
  });
});
