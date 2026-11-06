import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createOutputTail, describeEarlyExit } from '../src/main/serveweb-failure';
import { choosePort, pickPort } from '../src/main/serveweb-port';

const held: net.Server[] = [];

afterEach(async () => {
  await Promise.all(held.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function occupy() {
  return new Promise<number>((resolve) => {
    const srv = net.createServer();
    held.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as net.AddressInfo).port));
  });
}

describe('pickPort', () => {
  it('keeps the preferred port when it is free', async () => {
    const probe = await occupy();
    await new Promise<void>((r) => held.pop()?.close(() => r()));
    expect(await pickPort(probe)).toBe(probe);
  });

  it('picks a different free port when the preferred one is occupied', async () => {
    const taken = await occupy();
    const chosen = await pickPort(taken);
    expect(chosen).not.toBe(taken);
    expect(chosen).toBeGreaterThan(0);
  });
});

describe('choosePort', () => {
  it('moves off an occupied port held by another app', async () => {
    const taken = await occupy();
    expect(await choosePort('foreign', taken)).not.toBe(taken);
    expect(await choosePort('stuck', taken)).not.toBe(taken);
  });

  it('moves off a port held on all interfaces, which a loopback bind alone would not notice', async () => {
    const taken = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      held.push(srv);
      srv.listen(0, '0.0.0.0', () => resolve((srv.address() as net.AddressInfo).port));
    });
    expect(await choosePort('foreign', taken)).not.toBe(taken);
    expect(await choosePort('stuck', taken)).not.toBe(taken);
  });

  it('sticks to the previous fallback port while it is free, so open tabs keep working', async () => {
    const taken = await occupy();
    const fallback = await choosePort('foreign', taken);
    expect(await choosePort('foreign', taken, fallback)).toBe(fallback);
    expect(await choosePort('free', taken, fallback)).toBe(fallback);
  });

  it('abandons the previous fallback port when something holds it', async () => {
    const taken = await occupy();
    const previous = await occupy();
    expect(await choosePort('foreign', taken, previous)).not.toBe(previous);
  });

  it('reuses the preferred port when it is our own server', async () => {
    const taken = await occupy();
    expect(await choosePort('own', taken)).toBe(taken);
  });
});

describe('describeEarlyExit', () => {
  it('reports the port in use from the server output', () => {
    const lines = ['Starting', 'Could not start server on the given host/port'];
    expect(describeEarlyExit(lines, 9888)).toBe('Port 9888 is in use. Retry starts the editor on another port.');
  });

  it('includes the last lines of output for any other failure', () => {
    const tail = createOutputTail(3);
    for (const l of ['one', 'two', '', 'three', 'four']) tail.push(l);
    const message = describeEarlyExit(tail.lines(), 9888);
    expect(message).toContain('three');
    expect(message).toContain('four');
    expect(message).toContain('two');
    expect(message).not.toContain('one');
  });

  it('falls back to the generic message with no output', () => {
    expect(describeEarlyExit([], 9888)).toBe('The VS Code server stopped before the editor was ready.');
  });
});
