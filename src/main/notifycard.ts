import path from 'node:path';
import { isSubagentEvent } from './subagent';

interface NotifyPayload {
  cwd?: unknown;
  repoName?: unknown;
  [key: string]: unknown;
}

// The hook labels a card with its git toplevel, which inside a worktree is the
// worktree folder ("agent-…"); relabel it with the project the click will open.
function overlayCard(payload: NotifyPayload | null, rootForCwd: (cwd: string) => string) {
  if (!payload || typeof payload !== 'object' || isSubagentEvent(payload)) return null;
  if (typeof payload.cwd !== 'string' || !payload.cwd) return payload;
  const root = rootForCwd(payload.cwd);
  return { ...payload, repoName: path.basename(root) || payload.repoName };
}

export { overlayCard };
