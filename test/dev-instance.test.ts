import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { devInstance, hslToRgb, recordInstance, seedUserData, shortName, tintBitmap } from '../src/main/dev-instance';

const noBranch = () => null;
const tmps: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-dev-instance-'));
  tmps.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('devInstance', () => {
  it('gives worktrees with the same folder name their own key and a stable colour', () => {
    const a = devInstance('/w/14e3/lantern/out', {}, noBranch);
    const b = devInstance('/w/57a6/lantern/out', {}, noBranch);
    expect(a.key).not.toBe(b.key);
    expect(a.key).toMatch(/^lantern-[0-9a-f]{6}$/);
    expect(devInstance('/w/14e3/lantern/out', {}, noBranch)).toEqual(a);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
  });

  it('names the build after the branch, the folder, or LANTERN_INSTANCE', () => {
    expect(devInstance('/w/lantern-x/out', {}, () => 'feat/dev-instances')).toMatchObject({ name: 'feat/dev-instances', branch: 'feat/dev-instances', worktree: '/w/lantern-x' });
    expect(devInstance('/w/lantern-x/out', {}, noBranch).name).toBe('lantern-x');
    expect(devInstance('/w/lantern-x/out', { LANTERN_INSTANCE: 'Review A' }, () => 'main')).toMatchObject({ name: 'Review A', key: 'review-a' });
  });
});

describe('seedUserData', () => {
  it('copies the shared dev settings once and never overwrites the build’s own', () => {
    const shared = tmp();
    const own = path.join(tmp(), 'Lantern-dev-x');
    fs.writeFileSync(path.join(shared, 'ccm-projects.json'), '["shared"]');
    fs.writeFileSync(path.join(shared, 'SingletonLock'), '');
    seedUserData(own, shared);
    expect(fs.readFileSync(path.join(own, 'ccm-projects.json'), 'utf8')).toBe('["shared"]');
    expect(fs.existsSync(path.join(own, 'SingletonLock'))).toBe(false);
    fs.writeFileSync(path.join(own, 'ccm-projects.json'), '["own"]');
    seedUserData(own, shared);
    expect(fs.readFileSync(path.join(own, 'ccm-projects.json'), 'utf8')).toBe('["own"]');
  });
});

describe('recordInstance', () => {
  it('merges ports into this run’s record and drops a previous run’s', () => {
    const out = tmp();
    const file = path.join(out, 'lantern-instance.json');
    fs.writeFileSync(file, JSON.stringify({ pid: -42, debugPort: 1 }));
    recordInstance(out, { httpPort: 5000 });
    recordInstance(out, { debugPort: 5001 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ pid: process.pid, httpPort: 5000, debugPort: 5001 });
  });
});

describe('menu bar marking', () => {
  it('shortens the name to its last segment, ten characters at most', () => {
    expect(shortName('feat/dev-instances')).toBe('dev-insta…');
    expect(shortName('feat/dev-instances')).toHaveLength(10);
    expect(shortName('fix/topbar')).toBe('topbar');
    expect(shortName('smoke-b')).toBe('smoke-b');
    expect(shortName('abcdefghij')).toBe('abcdefghij');
  });

  it('converts a hue to rgb', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
  });

  it('tints a premultiplied BGRA bitmap and keeps its alpha', () => {
    const opaque = [10, 20, 30, 255];
    const half = [5, 5, 5, 128];
    const clear = [0, 0, 0, 0];
    const out = tintBitmap(Buffer.from([...opaque, ...half, ...clear]), [200, 100, 50]);
    expect([...out]).toEqual([50, 100, 200, 255, 25, 50, 100, 128, 0, 0, 0, 0]);
  });
});
