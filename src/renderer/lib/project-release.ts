import type { FreeMemoryFailure, FreeMemoryResult, MemoryKind } from '../../shared/memory';
import { hasLiveSession } from './idle-tabs';

export type ReleaseMode = 'free' | 'remove';
export type ReleaseOutcome = 'cancelled' | 'nothing-open' | 'freed' | 'closed-only' | 'removed';

export interface ReleaseDeps {
  isOpen(path: string): boolean;
  sessionsOf(path: string): readonly { state: string }[] | undefined;
  confirm(message: string): boolean;
  closeTab(path: string): void;
  freeMemory(path: string): Promise<FreeMemoryResult>;
  hide(path: string): Promise<unknown>;
  announce(text: string): void;
}

const FAILURE_REASON: Record<FreeMemoryFailure, string> = {
  unsupported: 'freeing memory is only supported on macOS',
  'invalid-project': 'the project folder is no longer available',
  'no-server': 'Lantern did not start this editor server',
  'shared-window': 'the project is also open in its own window',
  'no-host': 'its extension host was not found',
  unreadable: 'the process list could not be read',
};

const AGENT_KINDS: MemoryKind[] = ['claude', 'codex'];

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function describeKinds(terminated: Partial<Record<MemoryKind, number>>) {
  const count = (kinds: MemoryKind[]) => kinds.reduce((sum, kind) => sum + (terminated[kind] ?? 0), 0);
  const hosts = count(['extension-host']);
  const servers = count(['tsserver']);
  const agents = count(AGENT_KINDS);
  const total = Object.values(terminated).reduce((sum, value) => sum + (value ?? 0), 0);
  const rest = total - hosts - servers - agents;
  const parts = [
    hosts && plural(hosts, 'extension host', 'extension hosts'),
    servers && plural(servers, 'TypeScript server', 'TypeScript servers'),
    agents && plural(agents, 'agent', 'agents'),
    rest && plural(rest, 'other process', 'other processes'),
  ].filter(Boolean);
  return { total, text: parts.join(', ') };
}

export function describeRelease(name: string, mode: ReleaseMode, result: FreeMemoryResult) {
  const removed = mode === 'remove' ? ' and removed it from the sidebar' : '';
  if (result.ok) {
    const { total, text } = describeKinds(result.terminated);
    return `Freed memory: stopped ${plural(total, 'process', 'processes')} of ${name} (${text})${removed}.`;
  }
  return `Closed ${name}${removed}, but its editor processes were not stopped: ${FAILURE_REASON[result.reason]}. The editor server frees them after its reconnection grace time.`;
}

export function confirmText(name: string, mode: ReleaseMode) {
  const effect = mode === 'remove' ? 'Removing it' : 'Freeing its memory';
  return `${name} has an agent session that is running or waiting. ${effect} stops the editor it runs in and ends that session. Continue?`;
}

export async function releaseProject({ path, name, mode }: { path: string; name: string; mode: ReleaseMode }, deps: ReleaseDeps): Promise<ReleaseOutcome> {
  const open = deps.isOpen(path);
  if (!open && mode === 'free') return 'nothing-open';
  if (open && hasLiveSession(deps.sessionsOf(path) ?? []) && !deps.confirm(confirmText(name, mode))) return 'cancelled';
  if (!open) {
    await deps.hide(path);
    return 'removed';
  }
  deps.closeTab(path);
  const result = await deps.freeMemory(path).catch((): FreeMemoryResult => ({ ok: false, reason: 'unreadable' }));
  if (mode === 'remove') await deps.hide(path);
  deps.announce(describeRelease(name, mode, result));
  if (mode === 'remove') return 'removed';
  return result.ok ? 'freed' : 'closed-only';
}
