import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundledSkillDir } from '../src/main/agent';
import { isProgress, readProgress, runPlanStatus } from '../src/main/setup-progress';
import type { SetupProgress } from '../src/main/setup-progress';
import { makeSetupProject, mapFiles, writeLantern } from './helpers/setup-project';
import type { SetupProject } from './helpers/setup-project';

const PLAN = path.join(bundledSkillDir(), 'scripts', 'plan.mjs');

let project: SetupProject;

beforeEach(() => {
  vi.stubEnv('LANTERN_LANG', '');
  project = makeSetupProject();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(project.root, { recursive: true, force: true });
});

function planJson(root: string): SetupProgress {
  return JSON.parse(execFileSync(process.execPath, [PLAN, root, 'status', '--json'], { encoding: 'utf8', env: { ...process.env, LANTERN_LANG: 'en' } }));
}

describe('plan.mjs status --json', () => {
  it('reports nothing mapped for a project with no .lantern', () => {
    const p = planJson(project.root);
    expect(p.files).toEqual({ done: 0, total: 63 });
    expect(p.chunks).toEqual({ done: 0, total: 3 });
    expect(p.next).toEqual({ id: 1, dir: 'big', files: 25, pending: 25 });
    expect(p.features).toBe(false);
    expect(p.platforms).toBe(false);
    expect(p.sections).toBe(0);
  });

  it('counts a finished chunk and points at the next pending one', () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    const p = planJson(project.root);
    expect(p.files).toEqual({ done: 25, total: 63 });
    expect(p.chunks).toEqual({ done: 1, total: 3 });
    expect(p.next).toEqual({ id: 2, dir: 'big', files: 25, pending: 25 });
    expect(p.bytes.done).toBeGreaterThan(0);
    expect(p.bytes.done).toBeLessThan(p.bytes.total);
  });

  it('does not count a record without its text as mapped', () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    fs.rmSync(path.join(project.root, '.lantern', 'lang'), { recursive: true });
    expect(planJson(project.root).files.done).toBe(0);
  });

  it('does not count a file edited after it was mapped', () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    fs.appendFileSync(path.join(project.root, project.bigFiles[3]), '// edited\n');
    const p = planJson(project.root);
    expect(p.files.done).toBe(24);
    expect(p.chunks.done).toBe(0);
    expect(p.next).toEqual({ id: 1, dir: 'big', files: 25, pending: 1 });
  });

  it('sees the features, platforms and sections files', () => {
    writeLantern(project.root, 'features', 'billing\n');
    writeLantern(project.root, 'platforms', 'web big/**\n');
    writeLantern(project.root, 'sections/rbac.section', '');
    const p = planJson(project.root);
    expect([p.features, p.platforms, p.sections]).toEqual([true, true, 1]);
  });

  it('reports no next chunk once every file is mapped', () => {
    mapFiles(project.root, [...project.bigFiles, ...project.smallFiles]);
    const p = planJson(project.root);
    expect(p.next).toBeNull();
    expect(p.files).toEqual({ done: 63, total: 63 });
    expect(p.chunks).toEqual({ done: 3, total: 3 });
  });

  it('keeps the plain-text status line unchanged', () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    const text = execFileSync(process.execPath, [PLAN, project.root, 'status'], { encoding: 'utf8', env: { ...process.env, LANTERN_LANG: 'en' } });
    expect(text.trim()).toBe('files 25/63 mapped, chunks 1/3 done');
  });
});

describe('resume skips finished chunks', () => {
  it('lists only the unfinished chunks as pending after a stop, with the finished files untouched', () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    const mapFile = path.join(project.root, '.lantern', 'map', 'big.lantern');
    const before = fs.readFileSync(mapFile, 'utf8');
    const pending = execFileSync(process.execPath, [PLAN, project.root, 'pending'], { encoding: 'utf8', env: { ...process.env, LANTERN_LANG: 'en' } });
    const ids = [...pending.matchAll(/^chunk (\d+):/gm)].map((m) => Number(m[1]));
    expect(ids).toEqual([2, 3]);
    const chunk1 = execFileSync(process.execPath, [PLAN, project.root, 'chunk', '1'], { encoding: 'utf8', env: { ...process.env, LANTERN_LANG: 'en' } });
    expect(chunk1.split('\n').filter((l) => / todo /.test(l))).toHaveLength(0);
    expect(fs.readFileSync(mapFile, 'utf8')).toBe(before);
  });
});

describe('runPlanStatus (worker thread)', () => {
  it('returns the same progress the script prints', async () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    expect(await runPlanStatus(project.root, 'en')).toEqual(planJson(project.root));
  });

  it('answers null for a script that fails and for output that is not progress', async () => {
    const dir = fs.mkdtempSync(path.join(project.root, 'script-'));
    const broken = path.join(dir, 'broken.mjs');
    fs.writeFileSync(broken, 'process.exit(2);\n');
    const noisy = path.join(dir, 'noisy.mjs');
    fs.writeFileSync(noisy, "console.log('{\"files\":1}');\n");
    expect(await runPlanStatus(project.root, 'en', broken)).toBeNull();
    expect(await runPlanStatus(project.root, 'en', noisy)).toBeNull();
    expect(await runPlanStatus(project.root, 'en', path.join(dir, 'missing.mjs'))).toBeNull();
  });

  it('gives up on a script that never ends', async () => {
    const dir = fs.mkdtempSync(path.join(project.root, 'script-'));
    const hang = path.join(dir, 'hang.mjs');
    fs.writeFileSync(hang, 'setInterval(() => {}, 1000);\n');
    expect(await runPlanStatus(project.root, 'en', hang, 150)).toBeNull();
  });

  it('uses the map language the run writes, not the machine default', async () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    fs.renameSync(path.join(project.root, '.lantern', 'lang', 'en'), path.join(project.root, '.lantern', 'lang', 'pl'));
    expect((await runPlanStatus(project.root, 'pl'))?.files.done).toBe(25);
    expect((await runPlanStatus(project.root, 'en'))?.files.done).toBe(0);
  });
});

describe('readProgress cache', () => {
  it('re-reads after .lantern/ changes and on demand, not on every call', async () => {
    mapFiles(project.root, project.bigFiles.slice(0, 25));
    const first = await readProgress(project.root, 'en');
    expect(first?.files.done).toBe(25);
    fs.appendFileSync(path.join(project.root, project.bigFiles[0]), '// edited\n');
    expect((await readProgress(project.root, 'en'))?.files.done).toBe(25);
    expect((await readProgress(project.root, 'en', true))?.files.done).toBe(24);
    mapFiles(project.root, project.bigFiles.slice(0, 50));
    expect((await readProgress(project.root, 'en'))?.files.done).toBe(49);
  });
});

describe('isProgress', () => {
  it('rejects anything that is not the progress shape', () => {
    expect(isProgress(null)).toBe(false);
    expect(isProgress({ files: { done: 1, total: 2 } })).toBe(false);
    expect(isProgress({ files: { done: 'x', total: 2 }, bytes: { done: 1, total: 2 }, chunks: { done: 1, total: 2 }, features: true })).toBe(false);
  });
});
