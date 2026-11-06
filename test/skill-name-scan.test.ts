import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
const OBSOLETE_NAME = ['delegate', 'lantern'].join('-');
const ALLOWED = [/^scripts\/lantern-bundle\.mjs$/, /^\.lantern\/prs\//, /^\.lantern\/plans\//];

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((file) => file && fs.existsSync(path.join(ROOT, file)));
}

const isAllowed = (file: string) => ALLOWED.some((pattern) => pattern.test(file));

describe('the delegate skill name', () => {
  const files = tracked();

  it('is not part of any tracked path', () => {
    expect(files.filter((file) => file.includes(OBSOLETE_NAME) && !isAllowed(file))).toEqual([]);
  });

  it('is written only in the installer list and in the pull request and plan records', () => {
    const found: string[] = [];
    for (const file of files) {
      if (isAllowed(file)) continue;
      const text = fs.readFileSync(path.join(ROOT, file));
      if (text.includes(0)) continue;
      if (text.toString('utf8').includes(OBSOLETE_NAME)) found.push(file);
    }
    expect(found).toEqual([]);
  });

  it('is written in the installer only as the obsolete skill entry and its four agent files', () => {
    const lines = fs.readFileSync(path.join(ROOT, 'scripts', 'lantern-bundle.mjs'), 'utf8').split('\n').filter((line) => line.includes(OBSOLETE_NAME));
    expect(lines.map((line) => line.trim().split(' ')[1])).toEqual(['OBSOLETE_SKILLS', 'OBSOLETE_AGENTS']);
  });
});
