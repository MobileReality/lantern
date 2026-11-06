// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrExplainDone, PrExplainSavedResult, PrExplainStartResult, PrExplanation } from '../src/shared/pr-explain';
import { createExplainHub } from '../src/renderer/lib/prexplain';
import { projectExplainClient } from '../src/renderer/lib/prexplain-client';
import type { ExplainHub, PrExplainClient } from '../src/renderer/lib/prexplain';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const TARGET = { pr: '24', path: 'test/new-a.ts', head: HEAD };
const flush = () => new Promise((r) => setTimeout(r, 0));

function explanation(text: string, head = HEAD): PrExplanation {
  return { text, head, at: 1, stale: head !== HEAD };
}

interface Fake {
  client: PrExplainClient;
  saved: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  finish(done: Partial<PrExplainDone> & { ok: boolean }): void;
  settle(result: PrExplainStartResult): void;
}

function fakeClient(saved: PrExplainSavedResult = { ok: true, explanation: null }): Fake {
  let listener: (done: PrExplainDone) => void = () => {};
  let settle: (result: PrExplainStartResult) => void = () => {};
  const savedFn = vi.fn(async () => saved);
  const start = vi.fn(() => new Promise<PrExplainStartResult>((resolve) => (settle = resolve)));
  const cancel = vi.fn(async () => true);
  return {
    client: {
      saved: savedFn,
      start,
      cancel,
      onDone: (cb) => {
        listener = cb;
        return () => {};
      },
    },
    saved: savedFn,
    start,
    cancel,
    finish: (done) => listener({ project: '/p', pr: TARGET.pr, path: TARGET.path, ok: false, cancelled: false, error: 'x', ...done } as PrExplainDone),
    settle: (result) => settle(result),
  };
}

let host: HTMLElement;
let hub: ExplainHub | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  hub?.dispose();
  hub = undefined;
  document.body.textContent = '';
});

function open(fake: Fake, target = TARGET) {
  hub = createExplainHub(fake.client, { enabled: true });
  const row = hub.row(target);
  host.append(row);
  return row;
}

const button = (row: HTMLElement, act: string) => row.querySelector(`button[data-explain="${act}"]`) as HTMLButtonElement | null;
const labels = (row: HTMLElement) => [...row.querySelectorAll('button[data-explain]')].map((b) => b.textContent);

describe('the explainer switch in the row', () => {
  it('renders no row with the switch off and nothing saved', async () => {
    const fake = fakeClient();
    hub = createExplainHub(fake.client, { enabled: false });
    const row = hub.row(TARGET);
    host.append(row);
    await flush();
    expect(row.hidden).toBe(true);
    expect(labels(row)).toEqual([]);
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('keeps a saved explanation readable but offers no way to start a run', async () => {
    const fake = fakeClient({ ok: true, explanation: explanation('It adds a guard.') });
    hub = createExplainHub(fake.client, { enabled: false });
    const row = hub.row(TARGET);
    host.append(row);
    await flush();
    expect(row.hidden).toBe(false);
    expect(row.querySelector('.lt-explain-text')?.textContent).toBe('It adds a guard.');
    expect(labels(row)).toEqual(['Copy']);
    expect(button(row, 'start')).toBeNull();
  });

  it('renders the Explain more button with the switch on', () => {
    const row = open(fakeClient());
    expect(row.hidden).toBe(false);
    expect(labels(row)).toEqual(['Explain more']);
  });

  it('is off by default in a mounted view', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const fake = fakeClient();
    const view = mountLanternView(root, mapOf({ nodes: [node('src/svc.ts', 'service')], prs: [pr('24', { head: HEAD, files: [{ path: 'test/new-a.ts', kind: 'added', mapped: false, reason: 'Because.' }] })] }), {
      pr: '24',
      explain: fake.client,
      readPrFile: async () => ({ ok: true, text: 'const a = 1;\n', truncated: false, binary: false, version: 'branch' }),
      readPrDiff: async () => ({ ok: true, diff: '@@ -1 +1 @@\n-a\n+b', truncated: false, binary: false }),
    });
    (root.querySelector('[data-pr-code="test/new-a.ts"]') as HTMLElement).click();
    expect(root.querySelector('button[data-explain="start"]')).toBeNull();
    view.dispose();
  });
});

describe('the Explain more row', () => {
  it('shows only the button and runs nothing until it is pressed', async () => {
    const fake = fakeClient();
    const row = open(fake);
    await flush();
    expect(labels(row)).toEqual(['Explain more']);
    expect(row.querySelector('.lt-explain-text')?.hasAttribute('hidden')).toBe(true);
    expect(fake.start).not.toHaveBeenCalled();
    hub!.row({ ...TARGET, path: 'test/other.ts' });
    hub!.row(TARGET);
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('is labelled for assistive technology and operable by keyboard', () => {
    const row = open(fakeClient());
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-label')).toBe('Explanation of this change');
    expect(row.querySelector('[role="status"]')).not.toBeNull();
    const press = button(row, 'start')!;
    expect(press.tagName).toBe('BUTTON');
    expect(press.type).toBe('button');
    expect(press.dataset.tip).not.toBe('');
  });

  it('starts one run on press, shows Explaining with Cancel, and ignores a second press', () => {
    const fake = fakeClient();
    const row = open(fake);
    const press = button(row, 'start')!;
    press.click();
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.start).toHaveBeenCalledWith('24', 'test/new-a.ts');
    expect(row.querySelector('.lt-explain-status')?.textContent).toBe('Explaining…');
    expect(labels(row)).toEqual(['Cancel']);
    press.click();
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(button(row, 'start')).toBeNull();
  });

  it('moves focus to Cancel while running and back to a button when done', async () => {
    const fake = fakeClient();
    const row = open(fake);
    const press = button(row, 'start')!;
    press.focus();
    press.click();
    expect(document.activeElement).toBe(button(row, 'cancel'));
    fake.finish({ ok: true, explanation: explanation('Done.') });
    expect(document.activeElement).toBe(button(row, 'start'));
  });

  it('shows the explanation with Regenerate and Copy when the run is done', () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    fake.finish({ ok: true, explanation: explanation('It guards the call.') });
    const text = row.querySelector('.lt-explain-text') as HTMLElement;
    expect(text.hidden).toBe(false);
    expect(text.textContent).toBe('It guards the call.');
    expect(labels(row)).toEqual(['Regenerate', 'Copy']);
    expect((row.querySelector('.lt-explain-stale') as HTMLElement).hidden).toBe(true);
    expect(row.querySelector('[role="status"]')?.textContent).toBe('Explanation ready');
  });

  it('renders the explanation as text, never as HTML', () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    const hostile = '<img src=x onerror="window.__pwned=1"><b>bold</b> <script>window.__pwned=2</script>';
    fake.finish({ ok: true, explanation: explanation(hostile) });
    const text = row.querySelector('.lt-explain-text') as HTMLElement;
    expect(text.textContent).toBe(hostile);
    expect(text.querySelector('img, b, script')).toBeNull();
    expect(text.children).toHaveLength(0);
    expect(row.querySelectorAll('img, script')).toHaveLength(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('runs again on Regenerate and replaces the text', () => {
    const fake = fakeClient({ ok: true, explanation: explanation('First.') });
    const row = open(fake);
    return flush().then(() => {
      expect(row.querySelector('.lt-explain-text')?.textContent).toBe('First.');
      button(row, 'start')!.click();
      expect(fake.start).toHaveBeenCalledTimes(1);
      expect(labels(row)).toEqual(['Cancel']);
      expect(row.querySelector('.lt-explain-text')?.textContent).toBe('First.');
      fake.finish({ ok: true, explanation: explanation('Second.') });
      expect(row.querySelector('.lt-explain-text')?.textContent).toBe('Second.');
    });
  });

  it('cancels a run: asks the main process to stop and goes back to the button', async () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    button(row, 'cancel')!.click();
    expect(fake.cancel).toHaveBeenCalledWith('24', 'test/new-a.ts');
    expect(labels(row)).toEqual(['Explain more']);
    fake.settle({ ok: false, error: 'Cancelled.' });
    await flush();
    expect(row.querySelector('.lt-explain-error')).toBeNull();
    fake.finish({ ok: false, cancelled: true, error: 'Cancelled.' });
    expect(labels(row)).toEqual(['Explain more']);
  });

  it('can be started again after a cancel', () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    button(row, 'cancel')!.click();
    button(row, 'start')!.click();
    expect(fake.start).toHaveBeenCalledTimes(2);
    expect(labels(row)).toEqual(['Cancel']);
  });

  it('shows a one-line reason and Retry when the run fails', () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    fake.finish({ ok: false, cancelled: false, error: 'Timed out after 120 seconds.' });
    const reason = row.querySelector('.lt-explain-error') as HTMLElement;
    expect(reason.textContent).toBe('Timed out after 120 seconds.');
    expect(reason.getAttribute('role')).toBe('alert');
    expect(labels(row)).toEqual(['Retry']);
    button(row, 'start')!.click();
    expect(fake.start).toHaveBeenCalledTimes(2);
  });

  it('explains a missing Claude binary in one line, with the full message on hover', async () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    const message = 'Claude CLI not found. Looked in: ~/.local/bin/claude, /usr/local/bin/claude. Run "which claude" in a terminal.';
    fake.settle({ ok: false, error: message });
    await flush();
    const reason = row.querySelector('.lt-explain-error') as HTMLElement;
    expect(reason.textContent).toBe('Claude CLI not found.');
    expect(reason.dataset.tip).toBe(message);
    expect(labels(row)).toEqual(['Retry']);
  });

  it('turns a rejected request into a failure instead of hanging', async () => {
    const fake = fakeClient();
    fake.start.mockRejectedValueOnce(new Error('ipc closed'));
    const row = open(fake);
    button(row, 'start')!.click();
    await flush();
    expect(row.querySelector('.lt-explain-error')?.textContent).toBe('ipc closed');
    expect(labels(row)).toEqual(['Retry']);
  });

  it('ignores the completion of another file', () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    fake.finish({ ok: true, path: 'test/other.ts', explanation: explanation('Not yours.') });
    expect(labels(row)).toEqual(['Cancel']);
  });

  it('copies the explanation', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const row = open(fakeClient({ ok: true, explanation: explanation('Copy me.') }));
    await flush();
    button(row, 'copy')!.click();
    expect(writeText).toHaveBeenCalledWith('Copy me.');
    await flush();
    expect(button(row, 'copy')?.textContent).toBe('Copied');
  });
});

describe('a saved explanation', () => {
  it('shows again when the file is reopened, without running anything', async () => {
    const fake = fakeClient({ ok: true, explanation: explanation('Saved earlier.') });
    const row = open(fake);
    await flush();
    expect(fake.saved).toHaveBeenCalledWith('24', 'test/new-a.ts', HEAD);
    expect(row.querySelector('.lt-explain-text')?.textContent).toBe('Saved earlier.');
    expect(labels(row)).toEqual(['Regenerate', 'Copy']);
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('is marked as from an earlier version of the PR when the head differs', async () => {
    const row = open(fakeClient({ ok: true, explanation: explanation('Old words.', OLD_HEAD) }));
    await flush();
    const stale = row.querySelector('.lt-explain-stale') as HTMLElement;
    expect(stale.hidden).toBe(false);
    expect(stale.textContent).toBe('From an earlier version of this PR');
    expect(row.querySelector('.lt-explain-text')?.textContent).toBe('Old words.');
  });

  it('becomes stale when the pull request head moves under an open row', async () => {
    const fake = fakeClient({ ok: true, explanation: explanation('Words.') });
    const row = open(fake);
    await flush();
    expect((row.querySelector('.lt-explain-stale') as HTMLElement).hidden).toBe(true);
    hub!.row({ ...TARGET, head: OLD_HEAD });
    expect((row.querySelector('.lt-explain-stale') as HTMLElement).hidden).toBe(false);
  });

  it('keeps the running state when the reader steps to another file and back', () => {
    const fake = fakeClient();
    const row = open(fake);
    button(row, 'start')!.click();
    hub!.row({ ...TARGET, path: 'test/other.ts' });
    expect(hub!.row(TARGET)).toBe(row);
    expect(labels(row)).toEqual(['Cancel']);
  });

  it('ignores a failed lookup and stays idle', async () => {
    const row = open(fakeClient({ ok: false, error: 'nope' }));
    await flush();
    expect(labels(row)).toEqual(['Explain more']);
  });
});

describe('the window client', () => {
  it('passes the project on every call and only hears completions of its own project', () => {
    let push: (done: PrExplainDone) => void = () => {};
    const bridge = {
      prExplainSaved: vi.fn(async () => ({ ok: true as const, explanation: null })),
      prExplainStart: vi.fn(async () => ({ ok: true as const })),
      prExplainCancel: vi.fn(async () => true),
      onPrExplainDone: vi.fn((cb: (done: PrExplainDone) => void) => {
        push = cb;
      }),
    };
    (window as unknown as { ccmws: typeof bridge }).ccmws = bridge;
    const client = projectExplainClient('/work/one');
    void client.saved('7', 'a.ts', HEAD);
    void client.start('7', 'a.ts');
    void client.cancel('7', 'a.ts');
    expect(bridge.prExplainSaved).toHaveBeenCalledWith('/work/one', '7', 'a.ts', HEAD);
    expect(bridge.prExplainStart).toHaveBeenCalledWith('/work/one', '7', 'a.ts');
    expect(bridge.prExplainCancel).toHaveBeenCalledWith('/work/one', '7', 'a.ts');

    const heard: string[] = [];
    const off = client.onDone((done) => heard.push(done.project));
    push({ project: '/work/one', pr: '7', path: 'a.ts', ok: false, cancelled: false, error: 'x' });
    push({ project: '/work/two', pr: '7', path: 'a.ts', ok: false, cancelled: false, error: 'x' });
    off();
    push({ project: '/work/one', pr: '7', path: 'a.ts', ok: false, cancelled: false, error: 'x' });
    expect(heard).toEqual(['/work/one']);
    expect(bridge.onPrExplainDone).toHaveBeenCalledTimes(1);
  });
});

describe('in the review pane', () => {
  const PR = pr('24', { head: HEAD, files: [{ path: 'test/new-a.ts', kind: 'added', mapped: false, reason: 'Because.' }, { path: 'test/new-b.ts', kind: 'added', mapped: false }] });
  const mounted: ReturnType<typeof mountLanternView>[] = [];

  function mount(explain?: PrExplainClient) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/svc.ts', 'service')], prs: [PR] }), {
      pr: '24',
      explain,
      explainEnabled: true,
      readPrFile: async () => ({ ok: true, text: 'const a = 1;\n', truncated: false, binary: false, version: 'branch' }),
      readPrDiff: async () => ({ ok: true, diff: '@@ -1 +1 @@\n-a\n+b', truncated: false, binary: false }),
    }));
    return root;
  }

  afterEach(() => {
    for (const view of mounted.splice(0)) view.dispose();
  });

  it('puts the row directly under the reason and shows nothing without a client', async () => {
    const fake = fakeClient();
    const root = mount(fake.client);
    (root.querySelector('[data-pr-diff="test/new-a.ts"]') as HTMLElement).click();
    await flush();
    const reason = root.querySelector('.lt-modal-reason') as HTMLElement;
    const row = root.querySelector('.lt-explain') as HTMLElement;
    expect(reason.nextElementSibling).toBe(row);
    expect(reason.textContent).toBe('ReasonBecause.');
    expect(fake.start).not.toHaveBeenCalled();

    for (const view of mounted.splice(0)) view.dispose();
    document.body.textContent = '';
    const plain = mount();
    (plain.querySelector('[data-pr-diff="test/new-a.ts"]') as HTMLElement).click();
    await flush();
    expect(plain.querySelector('.lt-explain')).toBeNull();
  });

  it('keeps the row for a file without a reason and for the file view too', async () => {
    const fake = fakeClient();
    const root = mount(fake.client);
    (root.querySelector('[data-pr-code="test/new-b.ts"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-modal-reason')).toBeNull();
    expect(root.querySelector('.lt-explain')).not.toBeNull();
    expect(fake.saved).toHaveBeenCalledWith('24', 'test/new-b.ts', HEAD);
  });
});
