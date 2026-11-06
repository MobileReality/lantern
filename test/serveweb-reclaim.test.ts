import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { portListener, waitPortFree } from '../src/main/prockill';
import { reclaimPort } from '../src/main/serveweb-reclaim';

const LISTEN_TIMEOUT_MS = 5000;
const TEST_TIMEOUT_MS = 20_000;
const SERVER_JS = `require('node:net').createServer().listen(Number(process.argv[process.argv.indexOf('--port') + 1]), '127.0.0.1');`;

const orphans: number[] = [];
let dir = '';

afterEach(() => {
  for (const pid of orphans.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function freePort() {
  return new Promise<number>((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

// Backgrounded by a shell that exits at once, so the listener is reparented to
// launchd exactly like a serve-web left behind by an earlier Lantern run.
async function orphanListener(name: string, args: string) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclaim-'));
  const script = path.join(dir, name);
  fs.writeFileSync(script, SERVER_JS);
  const port = await freePort();
  spawn('sh', ['-c', `"${process.execPath}" "${script}" ${args} --port ${port} >/dev/null 2>&1 &`], { stdio: 'ignore' });
  const deadline = Date.now() + LISTEN_TIMEOUT_MS;
  let pid = await portListener(port);
  while (pid === null && Date.now() < deadline) pid = await portListener(port);
  if (pid === null) throw new Error('orphan never listened');
  orphans.push(pid);
  return { port, pid };
}

describe.skipIf(process.platform === 'win32')('reclaimPort', () => {
  it('is free when nothing listens', async () => {
    expect(await reclaimPort(await freePort(), () => {})).toBe('free');
  });

  it(
    'kills an orphaned serve-web holding the port and reports it free',
    async () => {
      const { port } = await orphanListener('code-tunnel', 'serve-web');
      let killing = false;
      expect(await reclaimPort(port, () => (killing = true))).toBe('free');
      expect(killing).toBe(true);
      expect(await portListener(port)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves a listener that is not serve-web alone',
    async () => {
      const { port, pid } = await orphanListener('some-app', 'serve');
      expect(await reclaimPort(port, () => {})).toBe('foreign');
      expect(await portListener(port)).toBe(pid);
    },
    TEST_TIMEOUT_MS,
  );

  it('treats this process as its own listener', async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address() as net.AddressInfo;
    expect(await reclaimPort(port, () => {})).toBe('own');
    await new Promise<void>((r) => srv.close(() => r()));
    await waitPortFree(port, LISTEN_TIMEOUT_MS);
  });
});
