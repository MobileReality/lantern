import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBundle, makeRepo } from './support/bundle-fixtures';

async function load() {
  vi.resetModules();
  return import('../src/shared/config');
}

afterEach(() => vi.unstubAllEnvs());

describe('dev profile', () => {
  it('moves the HTTP port off the installed app', async () => {
    vi.stubEnv('LANTERN_PROFILE', 'dev');
    const dev = await load();
    vi.stubEnv('LANTERN_PROFILE', '');
    const prod = await load();
    expect(dev.DEV_PROFILE).toBe(true);
    expect(prod.DEV_PROFILE).toBe(false);
    expect(dev.PORT).not.toBe(prod.PORT);
  });

  it('silences notifications in dev unless LANTERN_NOTIFICATIONS overrides', async () => {
    vi.stubEnv('LANTERN_PROFILE', 'dev');
    expect((await load()).NOTIFICATIONS_OFF).toBe(true);
    vi.stubEnv('LANTERN_NOTIFICATIONS', '1');
    expect((await load()).NOTIFICATIONS_OFF).toBe(false);
    vi.stubEnv('LANTERN_PROFILE', '');
    expect((await load()).NOTIFICATIONS_OFF).toBe(false);
    vi.stubEnv('LANTERN_NOTIFICATIONS', '0');
    expect((await load()).NOTIFICATIONS_OFF).toBe(true);
  });

  it('does not install the skill bundle into opened projects', async () => {
    vi.stubEnv('LANTERN_PROFILE', 'dev');
    vi.resetModules();
    const bundle = await import('../src/main/bundle');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-dev-profile-'));
    try {
      const project = path.join(tmp, 'project');
      const root = path.join(tmp, 'bundle');
      makeRepo(project);
      makeBundle(root);
      bundle.installOnOpen(project, { home: path.join(tmp, 'home'), root });
      await bundle.settled();
      expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
