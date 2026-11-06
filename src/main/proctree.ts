export interface ProcRow {
  pid: number;
  ppid: number;
  stat: string;
  command: string;
}

export type ListenerVerdict = { kind: 'none' } | { kind: 'own' } | { kind: 'foreign' } | { kind: 'stale'; root: number };

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/;
const SERVE_WEB = /(^|[\s/\\])(code|code-insiders|code-tunnel|code-tunnel-insiders)(\.cmd|\.exe)?\s+serve-web(\s|$)|[\s/\\]cli\.js\s+serve-web(\s|$)/i;
const DIRECT_SERVER = /[\s/\\]cli[\\/]serve-web[\\/][0-9a-f]{40}[\\/](bin[\\/]code-server|out[\\/]server-main\.js)\s.*--port[\s=]/i;
const INIT_PID = 1;

export function parsePsTable(text: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(PS_LINE);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), stat: m[3], command: m[4].trim() });
  }
  return rows;
}

export function descendantsOf(rows: ProcRow[], rootPid: number): number[] {
  const children = new Map<number, number[]>();
  for (const r of rows) {
    if (r.pid === r.ppid) continue;
    const list = children.get(r.ppid) ?? [];
    list.push(r.pid);
    children.set(r.ppid, list);
  }
  const found: number[] = [];
  const seen = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

export function isServeWebCommand(command: string) {
  return SERVE_WEB.test(command) || DIRECT_SERVER.test(command);
}

// The listener is `code-tunnel`, but it hangs under the `code` wrapper and the
// Electron CLI that launched it; climb to the topmost one so the whole chain dies.
function serveWebRoot(byPid: Map<number, ProcRow>, pid: number, selfPid: number) {
  let root = pid;
  for (let parent = byPid.get(root)?.ppid; parent && parent > INIT_PID && parent !== selfPid; parent = byPid.get(parent)?.ppid) {
    const row = byPid.get(parent);
    if (!row || !isServeWebCommand(row.command)) break;
    root = parent;
  }
  return root;
}

export function classifyListener(rows: ProcRow[], listenerPid: number | null, selfPid: number): ListenerVerdict {
  if (listenerPid === null) return { kind: 'none' };
  if (listenerPid === selfPid || descendantsOf(rows, selfPid).includes(listenerPid)) return { kind: 'own' };
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const row = byPid.get(listenerPid);
  if (!row) return { kind: 'none' };
  if (!isServeWebCommand(row.command)) return { kind: 'foreign' };
  const root = serveWebRoot(byPid, listenerPid, selfPid);
  const owner = byPid.get(root)?.ppid;
  if (owner && owner > INIT_PID && byPid.has(owner)) return { kind: 'foreign' };
  return { kind: 'stale', root };
}
