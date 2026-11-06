import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_ID = 'com.mobilereality.lantern';
const ID_PATTERN = /\bcom\.mobile-?reality\.[a-z0-9-]+(?:\.[a-z0-9-]+)*/gi;
const HISTORY = ['.lantern/prs/', '.lantern/plans/'];
const WRITES_THE_ID = ['package.json', 'src/cli/lantern', 'src/main/main.ts', 'test/cli-script.test.ts'];

function trackedFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return listing.split('\0').filter(Boolean);
}

function idsIn(text: string): string[] {
  return text.match(ID_PATTERN) ?? [];
}

function idsInFile(file: string): string[] {
  const absolute = path.join(ROOT, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return [];
  const content = fs.readFileSync(absolute);
  if (content.includes(0)) return [];
  return idsIn(content.toString('utf8'));
}

function differing(ids: string[]): string[] {
  return ids.filter((id) => id !== BUNDLE_ID);
}

describe('bundle id', () => {
  it('is com.mobilereality.lantern wherever a tracked file writes it', () => {
    const offenders = trackedFiles()
      .filter((file) => !HISTORY.some((prefix) => file.startsWith(prefix)))
      .flatMap((file) => differing(idsInFile(file)).map((id) => `${file}: ${id}`));
    expect(offenders).toEqual([]);
  });

  it('is written in the build scripts, the command line, the main process, and its tests', () => {
    for (const file of WRITES_THE_ID) expect(idsInFile(file), file).toContain(BUNDLE_ID);
  });

  it('is the id of both packaged builds', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    for (const name of ['build', 'build:win']) {
      expect(scripts[name].match(/--app-bundle-id=(\S+)/)?.[1], name).toBe(BUNDLE_ID);
    }
  });

  it('sees an id that differs', () => {
    expect(differing(idsIn(`open -b ${BUNDLE_ID}`))).toEqual([]);
    const suffixed = `${BUNDLE_ID}2`;
    const hyphenated = BUNDLE_ID.replace('mobilereality', 'mobile-reality');
    const extended = `${BUNDLE_ID}.dev`;
    expect(differing(idsIn(`open -b ${suffixed}`))).toEqual([suffixed]);
    expect(differing(idsIn(`--app-bundle-id=${hyphenated}`))).toEqual([hyphenated]);
    expect(differing(idsIn(`${extended}.`))).toEqual([extended]);
  });
});
