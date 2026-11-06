import { describe, expect, it, vi } from 'vitest';
import type { FreeMemoryResult } from '../src/shared/memory';
import { confirmText, describeRelease, releaseProject, type ReleaseDeps } from '../src/renderer/lib/project-release';

const PATH = '/work/docs';

function harness(overrides: Partial<ReleaseDeps> & { open?: boolean; sessions?: { state: string }[]; result?: FreeMemoryResult } = {}) {
  const { open = true, sessions = [], result = { ok: true, terminated: { 'extension-host': 1 } }, ...rest } = overrides;
  const calls: string[] = [];
  const deps: ReleaseDeps = {
    isOpen: () => open,
    sessionsOf: () => sessions,
    confirm: vi.fn(() => true),
    closeTab: vi.fn(() => calls.push('close')),
    freeMemory: vi.fn(async () => (calls.push('free'), result)),
    hide: vi.fn(async () => void calls.push('hide')),
    announce: vi.fn(),
    ...rest,
  };
  return { deps, calls };
}

const run = (mode: 'free' | 'remove', deps: ReleaseDeps) => releaseProject({ path: PATH, name: 'Docs', mode }, deps);

describe('Free memory', () => {
  it('closes the tab first, then frees the project, and does not hide it', async () => {
    const { deps, calls } = harness();
    expect(await run('free', deps)).toBe('freed');
    expect(calls).toEqual(['close', 'free']);
    expect(deps.freeMemory).toHaveBeenCalledExactlyOnceWith(PATH);
    expect(deps.hide).not.toHaveBeenCalled();
  });

  it('announces what it stopped', async () => {
    const { deps } = harness({ result: { ok: true, terminated: { 'extension-host': 2, tsserver: 1, claude: 1, codex: 1, test: 3 } } });
    await run('free', deps);
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith('Freed memory: stopped 8 processes of Docs (2 extension hosts, 1 TypeScript server, 2 agents, 3 other processes).');
  });

  it('does nothing for a project that is not open', async () => {
    const { deps } = harness({ open: false });
    expect(await run('free', deps)).toBe('nothing-open');
    expect(deps.closeTab).not.toHaveBeenCalled();
    expect(deps.freeMemory).not.toHaveBeenCalled();
    expect(deps.hide).not.toHaveBeenCalled();
    expect(deps.announce).not.toHaveBeenCalled();
  });

  it('closes the tab and says why nothing was stopped when the host cannot be identified', async () => {
    const { deps } = harness({ result: { ok: false, reason: 'no-host' } });
    expect(await run('free', deps)).toBe('closed-only');
    expect(deps.closeTab).toHaveBeenCalledOnce();
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith(
      'Closed Docs, but its editor processes were not stopped: its extension host was not found. The editor server frees them after its reconnection grace time.',
    );
  });

  it('treats a failed request like an unidentified host instead of failing silently', async () => {
    const { deps } = harness({ freeMemory: vi.fn(async () => Promise.reject(new Error('gone'))) });
    expect(await run('free', deps)).toBe('closed-only');
    expect(deps.closeTab).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.announce).mock.calls[0][0]).toContain('the process list could not be read');
  });
});

describe('Remove from sidebar', () => {
  it('does what Free memory does and then hides the project', async () => {
    const { deps, calls } = harness();
    expect(await run('remove', deps)).toBe('removed');
    expect(calls).toEqual(['close', 'free', 'hide']);
    expect(deps.hide).toHaveBeenCalledExactlyOnceWith(PATH);
    expect(vi.mocked(deps.announce).mock.calls[0][0]).toMatch(/^Freed memory: .* and removed it from the sidebar\.$/);
  });

  it('hides the project even when the host cannot be identified', async () => {
    const { deps, calls } = harness({ result: { ok: false, reason: 'shared-window' } });
    expect(await run('remove', deps)).toBe('removed');
    expect(calls).toEqual(['close', 'free', 'hide']);
    expect(vi.mocked(deps.announce).mock.calls[0][0]).toContain('Closed Docs and removed it from the sidebar, but its editor processes were not stopped: the project is also open in its own window.');
  });

  it('only hides a project that is not open, without asking, even with a live session', async () => {
    const { deps, calls } = harness({ open: false, sessions: [{ state: 'running' }] });
    expect(await run('remove', deps)).toBe('removed');
    expect(calls).toEqual(['hide']);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.freeMemory).not.toHaveBeenCalled();
    expect(deps.closeTab).not.toHaveBeenCalled();
  });
});

describe.each(['free', 'remove'] as const)('%s with an agent session', (mode) => {
  it.each(['running', 'permission', 'idle', 'unknown', 'unavailable'])('asks first when a session is %s', async (state) => {
    const { deps } = harness({ sessions: [{ state }], confirm: vi.fn(() => false) });
    expect(await run(mode, deps)).toBe('cancelled');
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith(confirmText('Docs', mode));
    expect(deps.closeTab).not.toHaveBeenCalled();
    expect(deps.freeMemory).not.toHaveBeenCalled();
    expect(deps.hide).not.toHaveBeenCalled();
    expect(deps.announce).not.toHaveBeenCalled();
  });

  it('proceeds once confirmed', async () => {
    const { deps } = harness({ sessions: [{ state: 'running' }], confirm: vi.fn(() => true) });
    expect(await run(mode, deps)).not.toBe('cancelled');
    expect(deps.closeTab).toHaveBeenCalledOnce();
    expect(deps.freeMemory).toHaveBeenCalledOnce();
  });

  it.each(['done', 'failed', 'stopped', 'ended'])('does not ask when the session is %s', async (state) => {
    const { deps } = harness({ sessions: [{ state }], confirm: vi.fn(() => false) });
    await run(mode, deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.freeMemory).toHaveBeenCalledOnce();
  });

  it('does not ask when the project has no sessions at all', async () => {
    const { deps } = harness({ sessions: [], confirm: vi.fn(() => false) });
    await run(mode, deps);
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});

describe('describeRelease', () => {
  it('counts a single process in the singular', () => {
    expect(describeRelease('Docs', 'free', { ok: true, terminated: { 'extension-host': 1 } })).toBe('Freed memory: stopped 1 process of Docs (1 extension host).');
  });

  it.each([
    ['unsupported', 'freeing memory is only supported on macOS'],
    ['invalid-project', 'the project folder is no longer available'],
    ['no-server', 'Lantern did not start this editor server'],
    ['shared-window', 'the project is also open in its own window'],
    ['no-host', 'its extension host was not found'],
    ['unreadable', 'the process list could not be read'],
  ] as const)('explains %s', (reason, text) => {
    expect(describeRelease('Docs', 'free', { ok: false, reason })).toContain(text);
  });
});
