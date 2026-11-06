import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { onProcessClose } from '../src/main/agent';

describe('agent process completion', () => {
  it('waits for trailing stdout before finalizing', async () => {
    const child = spawn(process.execPath, ['-e', "process.stdout.write('tail')"], { stdio: ['ignore', 'pipe', 'ignore'] });
    const order: string[] = [];
    child.stdout!.pause();
    child.once('exit', () => {
      order.push('exit');
      setTimeout(() => child.stdout!.resume(), 20);
    });
    child.stdout!.on('data', (data) => order.push(`data:${data}`));
    await new Promise<void>((resolve) => onProcessClose(child, () => {
      order.push('close');
      resolve();
    }));
    expect(order).toEqual(['exit', 'data:tail', 'close']);
  });
});
