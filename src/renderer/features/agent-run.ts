import { activeProjectPath } from '../state';
import { assistantName, providerForProject } from '../lib/providers';
import type { ToolsProvider } from '../lib/providers';
import { VIEW, say } from '../../shared/lantern-plan-messages';

type Kind = 'plan-fix' | 'lantern' | 'lantern-refresh';

interface RunHandler {
  begin(resumed: boolean): void;
  line(text: string, cls?: string): void;
  tool?(tool: string, detail?: string): void;
  done(ok: boolean, meta: { cost: string; secs: string; denials: number }): void;
  fail(text: string): void;
  cancelled(): void;
}

const NO_HANDLER: RunHandler = { begin() {}, line() {}, done() {}, fail() {}, cancelled() {} };

let running = false;
let currentRunId: number | null = null;
let runProvider: ToolsProvider = 'claude';
let starting = false;
let pendingEvents: AgentEvent[] = [];
let handler: RunHandler = NO_HANDLER;

function setBusy(on: boolean) {
  running = on;
  window.dispatchEvent(new CustomEvent('mr:agent-busy', { detail: on }));
}

async function run(kind: Kind, target: string | undefined, h: RunHandler) {
  const project = activeProjectPath();
  if (!project || running) return;
  handler = h;
  setBusy(true);
  currentRunId = null;
  runProvider = providerForProject(project);
  starting = runProvider === 'codex';
  pendingEvents = [];
  const res = await window.ccmws.agentRun(project, kind, target);
  starting = false;
  if (!res.ok) {
    setBusy(false);
    h.fail(res.error || 'Failed to start the agent.');
    return;
  }
  currentRunId = res.runId ?? null;
  if (running) h.begin(!!res.resumed);
  for (const event of pendingEvents) if (event.runId === currentRunId) applyEvent(event);
  pendingEvents = [];
}

function onEvent(e: AgentEvent) {
  if (runProvider === 'codex') {
    if (starting && currentRunId === null) {
      pendingEvents.push(e);
      return;
    }
    if (e.runId !== currentRunId) return;
  } else if (e.kind === 'cancelled' && (e.runId === undefined || e.runId !== currentRunId)) {
    return;
  }
  applyEvent(e);
}

function applyEvent(e: AgentEvent) {
  if (e.kind === 'start') handler.line('Session started…', 'muted');
  else if (e.kind === 'text' && e.text) handler.line(e.text.trim());
  else if (e.kind === 'tool') {
    handler.line(`→ ${e.tool}${e.detail ? ` ${e.detail}` : ''}`, 'tool');
    handler.tool?.(e.tool || '', e.detail);
  }
  else if (e.kind === 'done') {
    setBusy(false);
    const cost = e.costUsd ? `~$${e.costUsd.toFixed(2)}` : '';
    const secs = e.durationMs ? `${Math.round(e.durationMs / 1000)}s` : '';
    handler.done(!!e.ok, { cost, secs, denials: e.denials || 0 });
  } else if (e.kind === 'cancelled') {
    setBusy(false);
    handler.cancelled();
  } else if (e.kind === 'error') {
    setBusy(false);
    handler.fail(e.text || 'Failed');
  }
}

window.ccmws.onAgentEvent(onEvent);

function fixPlanFile(file: string, h: RunHandler) {
  if (!activeProjectPath()) {
    h.fail(say(VIEW.FIX_NO_PROJECT));
    return Promise.resolve();
  }
  return run('plan-fix', file, h);
}

function isBusy() {
  return running;
}

function startRun(kind: Kind, h: RunHandler) {
  return run(kind, undefined, h);
}

function cancelRun(): Promise<void> | void {
  if (runProvider === 'codex') {
    return window.ccmws.agentCancel().then(() => setBusy(false));
  }
  window.ccmws.agentCancel();
  setBusy(false);
}

export { fixPlanFile, isBusy, startRun, cancelRun };
export type { Kind, RunHandler };
