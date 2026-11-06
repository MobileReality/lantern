import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const OLD_NAME = ['claude', 'code', 'manage'].join('-');
const HISTORY = ['.lantern/prs/', '.lantern/plans/'];

function trackedFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return listing.split('\0').filter(Boolean);
}

function mentionsOldName(file: string): boolean {
  if (file.includes(OLD_NAME)) return true;
  const absolute = path.join(ROOT, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
  const content = fs.readFileSync(absolute);
  if (content.includes(0)) return false;
  return content.toString('utf8').includes(OLD_NAME);
}

describe('old package name', () => {
  it('appears in no tracked file outside the recorded history', () => {
    const offenders = trackedFiles()
      .filter((file) => !HISTORY.some((prefix) => file.startsWith(prefix)))
      .filter(mentionsOldName);
    expect(offenders).toEqual([]);
  });

  it('sees a tracked file that names it', () => {
    expect(mentionsOldName('package.json')).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'old-name-'));
    try {
      const probe = path.join(dir, 'probe.txt');
      fs.writeFileSync(probe, `x ${OLD_NAME} y`);
      expect(mentionsOldName(path.relative(ROOT, probe))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
