import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RtkStatus } from '../src/shared/rtk';

const detectRtk = vi.hoisted(() => vi.fn());
vi.mock('../skills/lantern-delegate/scripts/rtk-detect.mjs', () => ({ detectRtk }));

const missing = (): RtkStatus => ({ found: false, path: null, version: null, edition: null, hookFound: false, hookFiles: [], reason: 'not-installed' });
const present = (): RtkStatus => ({ ...missing(), found: true, path: '/x/rtk', version: '1.0.1', edition: 'oss', reason: null });
const projectDirsOf = () => detectRtk.mock.lastCall![0].projectDirs;
const loginShellOf = () => detectRtk.mock.lastCall![0].loginShell;

describe('rtk:status request handling', () => {
  let project: string;

  beforeEach(() => {
    vi.resetModules();
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-status-'));
    detectRtk.mockReset();
    detectRtk.mockResolvedValue(missing());
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('reads project settings only for a registered project directory', async () => {
    const { rtkStatus } = await import('../src/main/rtk-status');
    await rtkStatus(project, [project]);
    expect(projectDirsOf()).toEqual([project]);
    await rtkStatus(project, []);
    expect(projectDirsOf()).toEqual([]);
    await rtkStatus('relative/dir', [project]);
    expect(projectDirsOf()).toEqual([]);
    await rtkStatus({ evil: true }, [project]);
    expect(projectDirsOf()).toEqual([]);
    await rtkStatus(path.join(project, 'missing'), [path.join(project, 'missing')]);
    expect(projectDirsOf()).toEqual([]);
  });

  it('asks the login shell once, then not again for 30 seconds after a miss', async () => {
    const { rtkStatus } = await import('../src/main/rtk-status');
    let clock = 1_000_000;
    const now = () => clock;
    await rtkStatus(null, [], now);
    expect(loginShellOf()).toBe(true);
    clock += 29_000;
    await rtkStatus(null, [], now);
    expect(loginShellOf()).toBe(false);
    clock += 1_000;
    await rtkStatus(null, [], now);
    expect(loginShellOf()).toBe(true);
  });

  it('does not start the miss timer when RTK was found', async () => {
    const { rtkStatus } = await import('../src/main/rtk-status');
    detectRtk.mockResolvedValue(present());
    await rtkStatus(null, [], () => 5_000_000);
    await rtkStatus(null, [], () => 5_000_001);
    expect(loginShellOf()).toBe(true);
  });
});
