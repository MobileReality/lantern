import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupProgress } from '../src/main/setup-progress';
import { readSetupState, settleSetup } from '../src/main/setup-state';
import type { SetupKind } from '../src/main/settings';

function progress(done: number, total: number): SetupProgress {
  return { files: { done: done * 25, total: total * 25 }, bytes: { done, total }, chunks: { done, total }, next: done < total ? { id: done + 1, dir: 'src', files: 25, pending: 25 } : null, features: true, platforms: false, sections: 0 };
}

function deps(flag: SetupKind | null, value: SetupProgress | null) {
  const store = { flag };
  const readProgress = vi.fn(async () => value);
  return {
    store,
    readProgress,
    base: {
      project: '/proj',
      language: 'Polish',
      readProgress,
      settings: {
        setupUnfinished: () => store.flag,
        markSetup: (_p: string, kind: SetupKind | null) => {
          store.flag = kind;
        },
      },
    },
  };
}

describe('readSetupState', () => {
  it('never reads progress for a project with no unfinished run when nobody asked', async () => {
    const d = deps(null, progress(1, 3));
    expect(await readSetupState({ ...d.base })).toEqual({ progress: null, unfinished: null });
    expect(d.readProgress).not.toHaveBeenCalled();
  });

  it('offers the unfinished run with its progress, reading in the map language the run uses', async () => {
    const d = deps('lantern', progress(11, 42));
    const state = await readSetupState({ ...d.base });
    expect(state).toEqual({ progress: progress(11, 42), unfinished: 'lantern' });
    expect(d.readProgress).toHaveBeenCalledWith('/proj', 'pl', false);
  });

  it('reads on request for the run screen: cached for live, forced for fresh', async () => {
    const d = deps(null, progress(1, 3));
    await readSetupState({ ...d.base, mode: 'live' });
    expect(d.readProgress).toHaveBeenLastCalledWith('/proj', 'pl', false);
    await readSetupState({ ...d.base, mode: 'fresh' });
    expect(d.readProgress).toHaveBeenLastCalledWith('/proj', 'pl', true);
  });
});

describe('progress language without a requested one', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function polishMap() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-setup-lang-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.lantern', 'map'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.lantern', 'lang', 'pl'), { recursive: true });
    return dir;
  }

  it('reads and settles in the language the map is written in', async () => {
    vi.stubEnv('LANTERN_LANG', '');
    const project = polishMap();
    const d = deps('lantern-refresh', progress(3, 3));
    await readSetupState({ ...d.base, project, language: undefined, mode: 'fresh' });
    expect(d.readProgress).toHaveBeenLastCalledWith(project, 'pl', true);
    expect(await settleSetup({ ...d.base, project, language: undefined })).toBe(true);
    expect(d.readProgress).toHaveBeenLastCalledWith(project, 'pl', true);
  });

  it('still honours an explicit language', async () => {
    vi.stubEnv('LANTERN_LANG', '');
    const project = polishMap();
    const d = deps('lantern-refresh', progress(3, 3));
    await readSetupState({ ...d.base, project, language: 'English', mode: 'live' });
    expect(d.readProgress).toHaveBeenLastCalledWith(project, 'en', false);
  });
});

describe('settleSetup', () => {
  it('clears the unfinished flag when every chunk is mapped', async () => {
    const d = deps('lantern', progress(3, 3));
    expect(await settleSetup(d.base)).toBe(true);
    expect(d.store.flag).toBeNull();
  });

  it('clears it for a project with no source files to map', async () => {
    const d = deps('lantern', progress(0, 0));
    expect(await settleSetup(d.base)).toBe(true);
    expect(d.store.flag).toBeNull();
  });

  it('keeps it when a run that reported success left chunks undone', async () => {
    const d = deps('lantern', progress(2, 3));
    expect(await settleSetup(d.base)).toBe(false);
    expect(d.store.flag).toBe('lantern');
  });

  it('keeps it when progress could not be read', async () => {
    const d = deps('lantern-refresh', null);
    expect(await settleSetup(d.base)).toBe(false);
    expect(d.store.flag).toBe('lantern-refresh');
  });
});
