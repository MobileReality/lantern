import type { ParsedPr } from './lantern-pr-parse';

const MAX_PROJECTS = 32;
const MAX_RECORDS = 200;

interface Seen {
  pr: ParsedPr;
  source: 'tree' | 'remote' | 'local';
}

interface Remembered {
  pr: ParsedPr;
  closedAt?: string;
}

const byRoot = new Map<string, Map<string, Remembered>>();

function knownOf(root: string) {
  const known = byRoot.get(root) ?? new Map<string, Remembered>();
  byRoot.delete(root);
  byRoot.set(root, known);
  while (byRoot.size > MAX_PROJECTS) byRoot.delete(byRoot.keys().next().value as string);
  return known;
}

// A declined pull request never merges, so its record lives only on a branch that gets deleted and
// pruned; without this memory it would vanish from the load the moment that happens.
function restoreVanished(root: string, found: Seen[]) {
  const known = knownOf(root);
  const present = new Set(found.map((f) => f.pr.id));
  for (const f of found) if (f.source === 'remote') known.set(f.pr.id, { pr: f.pr });
  while (known.size > MAX_RECORDS) known.delete(known.keys().next().value as string);
  const closedAt = new Map<string, string>();
  const restored: Seen[] = [];
  for (const [id, entry] of known) {
    if (present.has(id)) continue;
    entry.closedAt ??= new Date().toISOString();
    closedAt.set(id, entry.closedAt);
    restored.push({ pr: entry.pr, source: 'remote' });
  }
  return { restored, closedAt };
}

export { restoreVanished };
