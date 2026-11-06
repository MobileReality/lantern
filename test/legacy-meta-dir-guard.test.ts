import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
const OLD_NAME = ['mr', 'code', 'helper'].join('-');

const ALLOWED = new Set([
  'src/main/metadir-migrate.ts',
  'test/lantern-delegate-skill.test.ts',
  'test/bundled-skills-standalone.test.ts',
]);
const RECORDS_OF_MERGED_PRS = '.lantern/prs/';

function filesNaming(name: string, scope: string[] = []) {
  const run = spawnSync('git', ['grep', '--untracked', '-l', '-I', '-F', '-e', name, '--', ...(scope.length ? scope : ['.'])], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0 && run.status !== 1) throw new Error(run.stderr);
  return run.stdout.split('\n').filter(Boolean);
}

describe('the old project data folder name', () => {
  it('appears only in the migration module and in tests that forbid it elsewhere', () => {
    const strays = filesNaming(OLD_NAME).filter((file) => !ALLOWED.has(file) && !file.startsWith(RECORDS_OF_MERGED_PRS));
    expect(strays).toEqual([]);
  });

  it('is still where the migration says it is', () => {
    expect(filesNaming(OLD_NAME, ['src/main/metadir-migrate.ts'])).toEqual(['src/main/metadir-migrate.ts']);
  });

  it('is named in no skill the app ships', () => {
    expect(filesNaming(OLD_NAME, ['skills'])).toEqual([]);
  });
});
