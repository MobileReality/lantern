import net from 'node:net';
import { portListener } from './prockill';
import type { ReclaimOutcome } from './serveweb-reclaim';

const LOOPBACK = '127.0.0.1';
const ANY_PORT = 0;

function listenOn(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(null));
    srv.listen(port, LOOPBACK, () => {
      const { port: bound } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(bound));
    });
  });
}

export async function anyFreePort(): Promise<number> {
  const assigned = await listenOn(ANY_PORT);
  if (assigned === null) throw new Error('No free local port is available.');
  return assigned;
}

export async function pickPort(preferred: number): Promise<number> {
  const kept = await listenOn(preferred);
  return kept ?? anyFreePort();
}

async function reusablePort(previous: number, preferred: number, isHeld: (port: number) => Promise<number | null>) {
  if (previous === preferred || (await isHeld(previous)) !== null) return null;
  return listenOn(previous);
}

// Open editor tabs keep the port they were built with, so a restart sticks to the last
// fallback port while it is still free. Binding 127.0.0.1 succeeds on macOS even when
// another app holds the same port on 0.0.0.0, so a port reported as held is never retried.
export async function choosePort(claim: ReclaimOutcome, preferred: number, previous = preferred, isHeld = portListener): Promise<number> {
  if (claim === 'own') return preferred;
  const reused = await reusablePort(previous, preferred, isHeld);
  if (reused !== null) return reused;
  if (claim === 'free') return pickPort(preferred);
  return anyFreePort();
}
