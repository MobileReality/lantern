import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/main/lantern';

const AI_FIXTURE = path.join(__dirname, 'fixtures', 'lantern-demo-ai', '.lantern');
let dirs: string[] = [];

function projectWithLang(code: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-primary-lang-'));
  dirs.push(dir);
  fs.cpSync(AI_FIXTURE, path.join(dir, '.lantern'), { recursive: true });
  if (code !== 'en') fs.renameSync(path.join(dir, '.lantern', 'lang', 'en'), path.join(dir, '.lantern', 'lang', code));
  return dir;
}

beforeEach(() => {
  vi.stubEnv('LANTERN_LANG', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('primary language without a setting', () => {
  it('uses the only language the map has, so a Polish map still shows its texts', async () => {
    const map = await load(projectWithLang('pl'));
    expect(map.language.primary).toBe('pl');
    expect(map.language.available).toEqual(['pl']);
    expect(map.nodes.length).toBeGreaterThan(0);
    expect(map.nodes.every((n) => n.purpose.length > 0)).toBe(true);
  });

  it('still defaults to English when English is present', async () => {
    const map = await load(projectWithLang('en'));
    expect(map.language.primary).toBe('en');
    expect(map.nodes.every((n) => n.purpose.length > 0)).toBe(true);
  });

  it('honours an explicit LANTERN_LANG over what is on disk', async () => {
    vi.stubEnv('LANTERN_LANG', 'en');
    const map = await load(projectWithLang('pl'));
    expect(map.language.primary).toBe('en');
    expect(map.nodes.some((n) => n.purpose.length === 0)).toBe(true);
  });
});
