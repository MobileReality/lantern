const SUBAGENT_WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]agent-[^\\/]+(?:[\\/]|$)/;

interface HookLike {
  hook_event_name?: unknown;
  hookEvent?: unknown;
  agent_id?: unknown;
  agentId?: unknown;
  cwd?: unknown;
}

function isSubagentCwd(cwd: unknown) {
  return typeof cwd === 'string' && SUBAGENT_WORKTREE.test(cwd);
}

// Raw hook input uses snake_case; the notify scripts forward it as camelCase.
function isSubagentEvent(payload: HookLike | null | undefined) {
  if (!payload) return false;
  const event = payload.hook_event_name ?? payload.hookEvent;
  if (event === 'SubagentStop') return true;
  if (payload.agent_id || payload.agentId) return true;
  return isSubagentCwd(payload.cwd);
}

export { isSubagentEvent, isSubagentCwd };
