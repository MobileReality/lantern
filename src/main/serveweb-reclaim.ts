import { killTree, portListener, psSnapshot, waitPortFree } from './prockill';
import { classifyListener } from './proctree';

export type ReclaimOutcome = 'free' | 'own' | 'foreign' | 'stuck';

export const KILL_GRACE_MS = 3000;
const PORT_FREE_TIMEOUT_MS = 5000;

// A serve-web this run didn't spawn can be wedged (e.g. stuck on "Code Server is
// downloading" after a VS Code update) and can't be recycled, so it's replaced.
export async function reclaimPort(port: number, onKilling: () => void): Promise<ReclaimOutcome> {
  const pid = await portListener(port);
  const verdict = classifyListener(await psSnapshot(), pid, process.pid);
  if (verdict.kind === 'none') return 'free';
  if (verdict.kind !== 'stale') return verdict.kind;
  onKilling();
  await killTree(verdict.root, KILL_GRACE_MS);
  return (await waitPortFree(port, PORT_FREE_TIMEOUT_MS)) ? 'free' : 'stuck';
}
