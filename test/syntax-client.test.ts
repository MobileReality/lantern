// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Request = { id: number; items: { lang: string; text: string }[] };

describe('syntax worker client', () => {
  const workers: FakeWorker[] = [];
  let constructorError = false;
  class FakeWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: () => void;
    onmessageerror?: () => void;
    requests: Request[] = [];
    terminated = false;
    constructor() {
      if (constructorError) { constructorError = false; throw new Error('constructor failed'); }
      workers.push(this);
    }
    postMessage(request: Request) { this.requests.push(request); }
    terminate() { this.terminated = true; }
  }

  beforeEach(() => {
    workers.length = 0;
    constructorError = false;
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker);
  });

  it('correlates out-of-order replies by monotonic id', async () => {
    const { highlightBatch } = await import('../src/renderer/lib/syntax-client');
    const first = highlightBatch([{ lang: 'typescript', text: 'first' }]);
    const second = highlightBatch([{ lang: 'typescript', text: 'second' }]);
    const worker = workers[0];
    expect(worker.requests.map(({ id }) => id)).toEqual([1, 2]);
    worker.onmessage?.({ data: { id: 2, lines: [['SECOND']] } } as MessageEvent);
    worker.onmessage?.({ data: { id: 1, lines: [['FIRST']] } } as MessageEvent);
    await expect(first).resolves.toEqual([['FIRST']]);
    await expect(second).resolves.toEqual([['SECOND']]);
  });

  it('falls back when eight requests are already pending', async () => {
    const { highlightBatch } = await import('../src/renderer/lib/syntax-client');
    for (let index = 0; index < 8; index++) void highlightBatch([{ lang: 'typescript', text: String(index) }]);
    await expect(highlightBatch([{ lang: 'typescript', text: '<overflow>' }])).resolves.toEqual([['&lt;overflow&gt;']]);
    expect(workers[0].requests).toHaveLength(8);
  });

  it('falls back all pending work and replaces a failed worker', async () => {
    const { highlightBatch } = await import('../src/renderer/lib/syntax-client');
    const pending = highlightBatch([{ lang: 'typescript', text: '<first>' }]);
    workers[0].onerror?.();
    await expect(pending).resolves.toEqual([['&lt;first&gt;']]);
    void highlightBatch([{ lang: 'typescript', text: 'next' }]);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
  });

  it('falls back when worker construction fails and recovers on the next request', async () => {
    constructorError = true;
    const { highlightBatch } = await import('../src/renderer/lib/syntax-client');
    await expect(highlightBatch([{ lang: 'typescript', text: '<failed>' }])).resolves.toEqual([['&lt;failed&gt;']]);

    const recovered = highlightBatch([{ lang: 'typescript', text: 'next' }]);
    expect(workers).toHaveLength(1);
    expect(workers[0].requests).toHaveLength(1);
    workers[0].onmessage?.({ data: { id: 2, lines: [['NEXT']] } } as MessageEvent);
    await expect(recovered).resolves.toEqual([['NEXT']]);
  });

  it('ignores stale failures from a replaced worker', async () => {
    const { highlightBatch } = await import('../src/renderer/lib/syntax-client');
    const first = highlightBatch([{ lang: 'typescript', text: '<first>' }]);
    const oldWorker = workers[0];
    oldWorker.onerror?.();
    await expect(first).resolves.toEqual([['&lt;first&gt;']]);

    const second = highlightBatch([{ lang: 'typescript', text: 'second' }]);
    const replacement = workers[1];
    oldWorker.onerror?.();
    oldWorker.onmessageerror?.();
    oldWorker.onmessage?.({ data: { id: 1, error: 'late failure' } } as MessageEvent);
    expect(replacement.terminated).toBe(false);
    replacement.onmessage?.({ data: { id: 2, lines: [['SECOND']] } } as MessageEvent);
    await expect(second).resolves.toEqual([['SECOND']]);
  });
});
