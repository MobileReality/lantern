import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTmp, write } from './helpers/git-repo';
import { PLAN_SCRIPT, REPO, SKILLS, removeDir } from './helpers/lantern-plan-world';

const LANG_SCRIPT = path.join(SKILLS, 'lantern-setup', 'scripts', 'lang.mjs');
const LIB = pathToFileURL(path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'lib.mjs')).href;
let dirs: string[] = [];

async function polishProject() {
  const dir = makeTmp('lantern-skill-lang-');
  dirs.push(dir);
  const lib = await import(LIB);
  write(dir, 'a.ts', 'export const a = 1;\n');
  write(dir, '.lantern/map/.lantern', `lantern 1\n# .\n\na.ts . util ${lib.hashFile(dir, 'a.ts')}\n`);
  write(dir, '.lantern/lang/pl/.lantern.json', '{"text":{"a.ts":"stala"}}\n');
  return dir;
}

function run(script: string, args: string[], cwd: string, lang: string) {
  const env = { ...process.env, LANTERN_LANG: lang, LANTERN_PROFILE: '' };
  return spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
}

afterEach(() => {
  for (const d of dirs) removeDir(d);
  dirs = [];
});

describe('readLang falls back to the map', () => {
  it('gives pl for a map whose only language folder is lang/pl, with no env', async () => {
    const dir = await polishProject();
    expect(run(LANG_SCRIPT, [dir], dir, '').stdout.trim()).toBe('pl');
  });

  it('lets LANTERN_LANG win', async () => {
    const dir = await polishProject();
    expect(run(LANG_SCRIPT, [dir], dir, 'en').stdout.trim()).toBe('en');
  });

  it('stays en when there is no map', () => {
    const dir = makeTmp('lantern-skill-lang-');
    dirs.push(dir);
    expect(run(LANG_SCRIPT, [dir], dir, '').stdout.trim()).toBe('en');
  });
});

describe('plan gate on a Polish map', () => {
  it('opens with no env', async () => {
    const dir = await polishProject();
    const result = run(PLAN_SCRIPT, ['gate', '--root', dir], dir, '');
    expect(result.stdout).toMatch(/GATE OPEN/);
    expect(result.status).toBe(0);
  });
});
