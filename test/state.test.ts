import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '../src/main/scanner';

let state: typeof import('../src/main/state');
const BASE = Date.parse('2026-01-01T00:00:00Z');

function snapshot(id: string, value: SessionSnapshot['state'], cwd = `/${id}`, changedAt = 0): SessionSnapshot {
  return { id, provider: 'claude', sessionId: id, cwd, kind: 'interactive', state: value, startedAt: BASE, waitingFor: '', changedAt };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
  vi.resetModules();
  state = await import('../src/main/state');
});

afterEach(() => vi.useRealTimers());

const codex = (hook_event_name: 'SessionStart' | 'UserPromptSubmit' | 'PermissionRequest' | 'Stop' | 'Interrupt' | 'SessionEnd', extra: Record<string, unknown> = {}) => ({
  session_id: 'thr_12345678',
  cwd: '/repo',
  hook_event_name,
  ...extra,
});

describe('applyCodexEvent', () => {
  it('shows each permission request and sends one first-stop notification', () => {
    state.applyCodexEvent(codex('SessionStart'));
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    const permission = state.applyCodexEvent(codex('PermissionRequest', { turn_id: 'turn-1' }));
    expect(permission?.session.state).toBe('permission');
    expect(permission?.notify?.kind).toBe('permission');
    const secondPermission = state.applyCodexEvent(codex('PermissionRequest', { turn_id: 'turn-1' }));
    expect(secondPermission?.notify?.kind).toBe('permission');
    expect(secondPermission?.notify?.id).not.toBe(permission?.notify?.id);
    const stop = state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1', last_assistant_message: 'ready' }));
    expect(stop?.session).toMatchObject({ provider: 'codex', state: 'done', lastMessage: 'ready' });
    expect(stop?.notify?.kind).toBe('stop');
    expect(state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }))?.notify).toBeNull();
  });

  it('returns to running for continuation while keeping one stop alert per turn', () => {
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }));
    const continuation = state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    expect(continuation?.session.state).toBe('running');
    expect(state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }))?.notify).toBeNull();
    expect(state.latest('/repo', 'codex')?.state).toBe('done');
  });

  it('does not let reordered events from an older turn replace the active turn', () => {
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }));
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-2' }));
    expect(state.applyCodexEvent(codex('PermissionRequest', { turn_id: 'turn-1' }))).toBeNull();
    expect(state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }))).toBeNull();
    expect(state.latest('/repo', 'codex')?.state).toBe('running');
  });

  it('handles missing turn ids with a short duplicate-stop window', () => {
    state.applyCodexEvent(codex('UserPromptSubmit'));
    expect(state.applyCodexEvent(codex('Stop'))?.notify?.kind).toBe('stop');
    expect(state.applyCodexEvent(codex('Stop'))?.notify).toBeNull();
    vi.advanceTimersByTime(6001);
    expect(state.applyCodexEvent(codex('Stop'))?.notify?.kind).toBe('stop');
  });

  it('treats interrupt as idle and session end as authoritative until its tombstone expires', () => {
    state.applyCodexEvent(codex('SessionStart'));
    expect(state.applyCodexEvent(codex('Interrupt'))?.session.state).toBe('idle');
    expect(state.applyCodexEvent(codex('SessionEnd'))?.session.state).toBe('ended');
    expect(state.latest('/repo', 'codex')).toBeNull();
    state.upsertRunnerSession('codex', 'thr_12345678', '/repo');
    state.mergeDiscovered([{ id: 'thr_12345678', provider: 'codex', cwd: '/repo', project: 'repo', state: 'running', updatedAt: Date.now() }]);
    expect(state.latest('/repo', 'codex')).toBeNull();
    vi.advanceTimersByTime(state.ENDED_TOMBSTONE_MS + 1);
    state.pruneStale();
    state.mergeDiscovered([{ id: 'thr_12345678', provider: 'codex', cwd: '/repo', project: 'repo', state: 'running', updatedAt: Date.now() }]);
    expect(state.latest('/repo', 'codex')?.source).toBe('scan');
  });

  it('keeps hook terminal states against runner fallback and ignores a late session start', () => {
    state.upsertRunnerSession('codex', 'thr_12345678', '/repo');
    const stopped = state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }));
    expect(stopped?.notify?.kind).toBe('stop');
    expect(state.finishRunnerSession('codex', 'thr_12345678', true)).toBe(false);
    state.applyCodexEvent(codex('SessionStart'));
    expect(state.latest('/repo', 'codex')?.state).toBe('done');
  });

  it('does not notify or change state for late permission after a terminal event', () => {
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }));
    expect(state.applyCodexEvent(codex('PermissionRequest', { turn_id: 'turn-1' }))).toBeNull();
    expect(state.latest('/repo', 'codex')?.state).toBe('done');
  });

  it('keeps the first terminal event authoritative in either arrival order', () => {
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-interrupt' }));
    expect(state.applyCodexEvent(codex('Interrupt', { turn_id: 'turn-interrupt' }))?.session.state).toBe('idle');
    expect(state.applyCodexEvent(codex('Stop', { turn_id: 'turn-interrupt' }))).toBeNull();
    expect(state.latest('/repo', 'codex')?.state).toBe('idle');

    const second = { session_id: 'thr_87654321' };
    state.applyCodexEvent(codex('UserPromptSubmit', { ...second, turn_id: 'turn-stop' }));
    expect(state.applyCodexEvent(codex('Stop', { ...second, turn_id: 'turn-stop' }))?.session.state).toBe('done');
    expect(state.applyCodexEvent(codex('Interrupt', { ...second, turn_id: 'turn-stop' }))).toBeNull();
    expect(state.all().find((session) => session.id === second.session_id)?.state).toBe('done');
  });

  it('keeps interrupt authoritative without a native turn id', () => {
    state.applyCodexEvent(codex('UserPromptSubmit'));
    expect(state.applyCodexEvent(codex('Interrupt'))?.session.state).toBe('idle');
    expect(state.applyCodexEvent(codex('Stop'))).toBeNull();
    expect(state.latest('/repo', 'codex')?.state).toBe('idle');
  });
});

describe('Codex runner and hook precedence', () => {
  it('keeps hook terminal and attention states authoritative over late runner callbacks', () => {
    const codex = (session_id: string, hook_event_name: 'SessionStart' | 'UserPromptSubmit' | 'PermissionRequest' | 'Stop' | 'Interrupt') =>
      state.applyCodexEvent({ session_id, cwd: '/r', hook_event_name, turn_id: 't1' });
    codex('permission-id', 'SessionStart');
    codex('permission-id', 'UserPromptSubmit');
    codex('permission-id', 'PermissionRequest');
    state.upsertRunnerSession('codex', 'permission-id', '/r');
    expect(state.finishRunnerSession('codex', 'permission-id', true)).toBe(false);
    expect(state.latest('/r', 'codex')?.state).toBe('permission');

    codex('done-id', 'SessionStart');
    codex('done-id', 'UserPromptSubmit');
    codex('done-id', 'Stop');
    state.upsertRunnerSession('codex', 'done-id', '/r');
    expect(state.finishRunnerSession('codex', 'done-id', false)).toBe(false);
    expect(state.all().find((session) => session.id === 'done-id')?.state).toBe('done');

    codex('interrupt-id', 'SessionStart');
    codex('interrupt-id', 'UserPromptSubmit');
    codex('interrupt-id', 'Interrupt');
    state.upsertRunnerSession('codex', 'interrupt-id', '/r');
    expect(state.finishRunnerSession('codex', 'interrupt-id', true)).toBe(false);
    expect(state.all().find((session) => session.id === 'interrupt-id')?.state).toBe('idle');
  });

  it('does not resurrect a hook-ended Codex session from runner or scanner updates', () => {
    state.applyCodexEvent({ session_id: 'ended-id', cwd: '/r', hook_event_name: 'SessionStart' });
    state.applyCodexEvent({ session_id: 'ended-id', cwd: '/r', hook_event_name: 'SessionEnd' });
    state.upsertRunnerSession('codex', 'ended-id', '/r');
    state.finishRunnerSession('codex', 'ended-id', true);
    const discovered = { id: 'ended-id', provider: 'codex', cwd: '/r', project: 'r', state: 'running', updatedAt: Date.now() };
    state.mergeDiscovered([discovered]);
    expect(state.latest('/r', 'codex')).toBeNull();
    vi.advanceTimersByTime(state.ENDED_TOMBSTONE_MS + 1);
    state.pruneStale();
    state.mergeDiscovered([discovered]);
    expect(state.latest('/r', 'codex')?.source).toBe('scan');
  });
});

describe('snapshot reconciliation', () => {
  it('uses the first successful snapshot as a silent baseline', () => {
    expect(state.reconcile([snapshot('a', 'done'), snapshot('b', 'permission')])).toEqual([]);
    expect(state.all().map((session) => session.state)).toEqual(['done', 'permission']);
  });

  it('stores Claude sessions under the claude provider with the resumable session id', () => {
    state.reconcile([{ ...snapshot('bg-1', 'running'), sessionId: 'uuid-1' }]);
    expect(state.all()).toMatchObject([{ id: 'bg-1', provider: 'claude', sessionId: 'uuid-1' }]);
    expect(state.latest('/bg-1', 'claude')?.id).toBe('bg-1');
    expect(state.latest('/bg-1', 'codex')).toBeNull();
  });

  it('notifies a turn that ends with a background task running once, not again when the task ends', () => {
    state.reconcile([snapshot('a', 'running')]);
    expect(state.reconcile([snapshot('a', 'shell')]).map((notice) => notice.kind)).toEqual(['finished']);
    expect(state.reconcile([snapshot('a', 'done')])).toEqual([]);
  });

  it('notifies once for observed actionable transitions and not for repeats or failures', () => {
    state.reconcile([snapshot('a', 'running'), snapshot('b', 'running')]);
    expect(state.reconcile([snapshot('a', 'done'), snapshot('b', 'permission')]).map((notice) => notice.kind)).toEqual(['finished', 'permission']);
    expect(state.reconcile([snapshot('a', 'done'), snapshot('b', 'permission')])).toEqual([]);
    expect(state.reconcile([snapshot('a', 'failed'), snapshot('b', 'stopped')]).map((notice) => notice.kind)).toEqual(['failed']);
    expect(state.reconcile([snapshot('a', 'idle'), snapshot('b', 'stopped')]).map((notice) => notice.kind)).toEqual(['waiting']);
  });

  it('notifies a turn that started and finished between two scans', () => {
    state.reconcile([snapshot('a', 'done', '/a', 10)]);
    expect(state.reconcile([snapshot('a', 'done', '/a', 10)])).toEqual([]);
    const [notice] = state.reconcile([snapshot('a', 'done', '/a', 20)]);
    expect(notice.kind).toBe('finished');
    expect(state.reconcile([snapshot('a', 'done', '/a', 20)])).toEqual([]);
    const [next] = state.reconcile([snapshot('a', 'done', '/a', 30)]);
    expect(next.session.updatedAt).toBeGreaterThanOrEqual(notice.session.updatedAt);
    expect(state.reconcile([snapshot('a', 'running', '/a', 40)])).toEqual([]);
  });

  it('stays quiet on a repeated state when the source gives no change time', () => {
    state.reconcile([snapshot('a', 'done')]);
    expect(state.reconcile([snapshot('a', 'done')])).toEqual([]);
  });

  it('notifies a short turn again after the finished session was cleared', () => {
    state.reconcile([snapshot('a', 'running', '/a', 10)]);
    expect(state.reconcile([snapshot('a', 'done', '/a', 20)]).map((n) => n.kind)).toEqual(['finished']);
    state.clearFinished();
    expect(state.reconcile([snapshot('a', 'done', '/a', 20)])).toEqual([]);
    expect(state.reconcile([snapshot('a', 'done', '/a', 30)]).map((n) => n.kind)).toEqual(['finished']);
  });

  it('keeps unknown-to-known and recovery snapshots quiet', () => {
    state.reconcile([snapshot('a', 'unknown')]);
    expect(state.reconcile([snapshot('a', 'done')])).toEqual([]);
    state.unavailable();
    expect(state.all()[0].state).toBe('unavailable');
    expect(state.reconcile([snapshot('a', 'running')])).toEqual([]);
  });

  it('does not churn timestamps for unchanged snapshots', () => {
    state.reconcile([snapshot('a', 'running')]);
    const first = state.all()[0].updatedAt;
    vi.advanceTimersByTime(1000);
    state.reconcile([snapshot('a', 'running')]);
    expect(state.all()[0].updatedAt).toBe(first);
  });

  it('removes sessions absent from a successful snapshot', () => {
    state.reconcile([snapshot('a', 'running')]);
    state.reconcile([]);
    expect(state.all()).toEqual([]);
  });

  it('reports availability only after a successful snapshot', () => {
    expect(state.isAvailable()).toBe(false);
    state.reconcile([]);
    expect(state.isAvailable()).toBe(true);
    state.unavailable();
    expect(state.isAvailable()).toBe(false);
  });
});

describe('Codex sessions beside the Claude poll', () => {
  const codexSession = (id = 'thr_12345678') => ({ id, provider: 'codex', cwd: '/codex-repo', project: 'codex-repo', state: 'running', updatedAt: 1 });

  it('never removes a Codex session when a snapshot without it is reconciled', () => {
    state.mergeDiscovered([codexSession()]);
    state.applyCodexEvent(codex('SessionStart', { session_id: 'thr_hooked01', cwd: '/hooked' }));
    state.upsertRunnerSession('codex', 'thr_runner01', '/runner');
    state.reconcile([snapshot('a', 'running')]);
    state.reconcile([]);
    expect(state.all().map((session) => session.id).sort()).toEqual(['thr_12345678', 'thr_hooked01', 'thr_runner01']);
  });

  it('never marks a Codex session unavailable when the poll fails', () => {
    state.mergeDiscovered([codexSession()]);
    state.reconcile([snapshot('a', 'running')]);
    state.unavailable();
    expect(state.all().map((session) => [session.provider, session.state]).sort()).toEqual([['claude', 'unavailable'], ['codex', 'running']]);
  });

  it('keeps Codex sessions through a failed poll before any baseline exists', () => {
    state.mergeDiscovered([codexSession()]);
    state.unavailable();
    expect(state.latest('/codex-repo', 'codex')?.state).toBe('running');
  });

  it('keeps a Claude and a Codex session that share a raw id apart', () => {
    state.mergeDiscovered([{ ...codexSession('same-id') }]);
    state.reconcile([snapshot('same-id', 'done')]);
    expect(state.all().map((session) => [session.provider, session.state]).sort()).toEqual([['claude', 'done'], ['codex', 'running']]);
    state.reconcile([]);
    expect(state.all().map((session) => session.provider)).toEqual(['codex']);
  });

  it('clearing finished sessions dismisses Claude ones until they change and drops finished Codex ones', () => {
    state.reconcile([snapshot('a', 'done'), snapshot('b', 'running')]);
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }));
    state.clearFinished();
    expect(state.all().map((session) => session.id)).toEqual(['b']);
    state.reconcile([snapshot('a', 'done'), snapshot('b', 'running')]);
    expect(state.all().map((session) => session.id)).toEqual(['b']);
    state.reconcile([snapshot('a', 'running'), snapshot('b', 'running')]);
    expect(state.all().map((session) => session.id).sort()).toEqual(['a', 'b']);
  });
});

describe('all — ordering', () => {
  it('sorts sessions most-recently-updated first', () => {
    state.applyCodexEvent(codex('SessionStart', { session_id: 'thr_00000001', cwd: '/a' }));
    vi.advanceTimersByTime(1000);
    state.applyCodexEvent(codex('SessionStart', { session_id: 'thr_00000002', cwd: '/b' }));
    expect(state.all().map((s) => s.id)).toEqual(['thr_00000002', 'thr_00000001']);
  });
});

describe('pruneStale', () => {
  it('removes only old, terminal, hook-sourced sessions', () => {
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }));
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    state.pruneStale();
    expect(state.all()).toHaveLength(0);
  });

  it('keeps recent terminal sessions', () => {
    state.applyCodexEvent(codex('UserPromptSubmit', { turn_id: 'turn-1' }));
    state.applyCodexEvent(codex('Stop', { turn_id: 'turn-1' }));
    vi.advanceTimersByTime(60 * 1000);
    state.pruneStale();
    expect(state.all()).toHaveLength(1);
  });

  it('never prunes a polled Claude session', () => {
    state.reconcile([snapshot('a', 'done')]);
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    state.pruneStale();
    expect(state.all()).toHaveLength(1);
  });
});

describe('mergeDiscovered', () => {
  it('adds scan-discovered sessions', () => {
    state.mergeDiscovered([{ id: 'd1', cwd: '/a', project: 'a', state: 'open', updatedAt: 1 }]);
    expect(state.all().map((s) => s.id)).toEqual(['d1']);
  });

  it('never overrides a hook session with scan data', () => {
    state.applyCodexEvent(codex('SessionStart', { session_id: 'thr_00000001', cwd: '/a' }));
    state.mergeDiscovered([{ id: 'thr_00000001', provider: 'codex', cwd: '/a', project: 'a', state: 'open', updatedAt: 1 }]);
    expect(state.all()[0].state).toBe('running');
  });

  it('drops scan sessions that are no longer present', () => {
    state.mergeDiscovered([{ id: 'd1', cwd: '/a', project: 'a', state: 'open', updatedAt: 1 }]);
    state.mergeDiscovered([]);
    expect(state.all()).toHaveLength(0);
  });

  it('keeps raw ids isolated by provider and resumes only the selected provider', () => {
    state.mergeDiscovered([
      { id: 'same-id', provider: 'claude', cwd: '/a', project: 'a', state: 'idle', updatedAt: 1 },
      { id: 'same-id', provider: 'codex', cwd: '/a', project: 'a', state: 'running', updatedAt: 2 },
    ]);
    expect(state.all()).toHaveLength(2);
    expect(state.latest('/a', 'claude')?.provider).toBe('claude');
    expect(state.latest('/a', 'codex')?.provider).toBe('codex');
  });

  it('selects context by provider and the caller-resolved project root', () => {
    state.mergeDiscovered([
      { id: 'nested-id', provider: 'codex', cwd: '/repo/packages/app', project: 'app', state: 'idle', updatedAt: 2 },
      { id: 'worktree-id', provider: 'codex', cwd: '/repo-worktree/packages/app', project: 'app', state: 'idle', updatedAt: 3 },
    ]);
    const root = (cwd: string) => cwd.startsWith('/repo-worktree/') ? '/repo-worktree' : cwd.startsWith('/repo/') ? '/repo' : cwd;
    expect(state.latest('/repo', 'codex', root)?.id).toBe('nested-id');
    expect(state.latest('/repo-worktree', 'codex', root)?.id).toBe('worktree-id');
    expect(state.latest('/repo', 'claude', root)).toBeNull();
  });

  it('does not let scanner data overwrite runner state', () => {
    state.upsertRunnerSession('codex', 'thread-id', '/a');
    state.mergeDiscovered([{ id: 'thread-id', provider: 'codex', cwd: '/a', project: 'a', state: 'idle', updatedAt: 1 }]);
    expect(state.latest('/a', 'codex')).toMatchObject({ state: 'running', source: 'runner' });
    state.finishRunnerSession('codex', 'thread-id', true);
    state.mergeDiscovered([{ id: 'thread-id', provider: 'codex', cwd: '/a', project: 'a', state: 'running', updatedAt: Date.now() }]);
    expect(state.latest('/a', 'codex')).toMatchObject({ state: 'done', source: 'runner' });
  });
});

describe('isClearable', () => {
  it('clears finished, failed and stopped Claude sessions, never a waiting or working one', () => {
    for (const value of ['done', 'failed', 'stopped']) expect(state.isClearable('claude', value), value).toBe(true);
    for (const value of ['idle', 'running', 'permission', 'shell']) expect(state.isClearable('claude', value), value).toBe(false);
  });

  it('clears finished, waiting and closed Codex sessions, never a working one', () => {
    for (const value of ['done', 'idle', 'ended']) expect(state.isClearable('codex', value), value).toBe(true);
    for (const value of ['running', 'permission', 'failed']) expect(state.isClearable('codex', value), value).toBe(false);
  });

  it('agrees with what clearFinished removes', () => {
    state.reconcile([snapshot('a', 'done'), snapshot('b', 'permission')]);
    state.applyCodexEvent(codex('SessionStart'));
    state.applyCodexEvent(codex('Interrupt', { turn_id: 'turn-1' }));
    state.clearFinished();
    expect(state.all().map((session) => session.id)).toEqual(['b']);
  });
});
