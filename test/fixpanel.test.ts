// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ provider: 'claude' as 'claude' | 'codex' }));
vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj' }));
vi.mock('../src/renderer/lib/providers', async (original) => {
  const actual = await original<typeof import('../src/renderer/lib/providers')>();
  return { ...actual, providerForProject: () => state.provider, assistantName: () => actual.providerLabel(state.provider) };
});

type Bridge = Window['ccmws'];
type Emit = (e: AgentEvent) => void;

function installBridge(runIds: number[]): { emit: Emit; agentCancel: ReturnType<typeof vi.fn> } {
  const holder: { emit: Emit } = { emit: () => {} };
  const agentCancel = vi.fn();
  const agentRun = vi.fn();
  for (const runId of runIds) agentRun.mockResolvedValueOnce({ ok: true, runId });
  const stub: Partial<Bridge> = {
    agentRun,
    agentCancel,
    onAgentEvent: (fn) => {
      holder.emit = fn;
    },
    agentStatus: vi.fn().mockResolvedValue({ running: false, available: true, provider: state.provider }),
  };
  window.ccmws = stub as Bridge;
  return { get emit() { return holder.emit; }, agentCancel } as { emit: Emit; agentCancel: ReturnType<typeof vi.fn> };
}

describe('run cancel', () => {
  beforeEach(() => {
    state.provider = 'claude';
    document.body.innerHTML = '';
  });

  it('resets the run owner when main reports a cancel pressed elsewhere', async () => {
    const bridge = installBridge([7]);
    vi.resetModules();
    const { startRun, isBusy } = await import('../src/renderer/features/agent-run');
    const handler = { begin: vi.fn(), line: vi.fn(), done: vi.fn(), fail: vi.fn(), cancelled: vi.fn() };
    await startRun('lantern', handler);
    expect(isBusy()).toBe(true);
    bridge.emit({ kind: 'cancelled', runId: 7 });
    expect(handler.cancelled).toHaveBeenCalledTimes(1);
    expect(handler.fail).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
  });

  it('ignores a stale cancelled event for an earlier run', async () => {
    const bridge = installBridge([7, 8]);
    vi.resetModules();
    const { startRun, isBusy } = await import('../src/renderer/features/agent-run');
    const first = { begin: vi.fn(), line: vi.fn(), done: vi.fn(), fail: vi.fn(), cancelled: vi.fn() };
    await startRun('lantern', first);
    bridge.emit({ kind: 'done', ok: true });
    const second = { begin: vi.fn(), line: vi.fn(), done: vi.fn(), fail: vi.fn(), cancelled: vi.fn() };
    await startRun('lantern', second);
    expect(isBusy()).toBe(true);
    bridge.emit({ kind: 'cancelled', runId: 7 });
    expect(second.cancelled).not.toHaveBeenCalled();
    expect(isBusy()).toBe(true);
    bridge.emit({ kind: 'cancelled', runId: 8 });
    expect(second.cancelled).toHaveBeenCalledTimes(1);
    expect(isBusy()).toBe(false);
  });
});
