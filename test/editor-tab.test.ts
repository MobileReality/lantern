// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchEditorTab } from '../src/renderer/features/editor-tab';
import { TAB_TIMEOUT_MS } from '../src/renderer/lib/editorload';

const PROBE_MS = 1000;

function fakeWebview(page: { kind: string }) {
  const target = new EventTarget() as EventTarget & { executeJavaScript: () => Promise<string>; reload: () => void };
  target.executeJavaScript = () => Promise.resolve(page.kind);
  target.reload = vi.fn();
  return target;
}

const opts = (label: () => string) => ({ label, otherPhases: () => [], serverReady: () => true });

describe('watchEditorTab', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('covers the tab with the project name before the first probe', () => {
    const watch = watchEditorTab(fakeWebview({ kind: 'blank' }), opts(() => 'lantern'));
    expect(watch.cover.classList.contains('hidden')).toBe(false);
    expect(watch.cover.textContent).toContain('lantern');
    watch.dispose();
  });

  it('keeps the download page covered and reveals the editor once the workbench exists', async () => {
    const page = { kind: 'downloading' };
    const watch = watchEditorTab(fakeWebview(page), opts(() => 'lantern'));
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(watch.phase()).toBe('downloading');
    expect(watch.cover.textContent).toContain('Updating VS Code Server');
    page.kind = 'workbench';
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(watch.phase()).toBe('ready');
    expect(watch.cover.classList.contains('hidden')).toBe(true);
    watch.dispose();
  });

  it('turns a download that never finishes into a failure with Retry', async () => {
    const watch = watchEditorTab(fakeWebview({ kind: 'downloading' }), opts(() => 'lantern'));
    await vi.advanceTimersByTimeAsync(TAB_TIMEOUT_MS.downloading + 2 * PROBE_MS);
    expect(watch.phase()).toBe('failed');
    expect(watch.cover.classList.contains('failed')).toBe(true);
    expect(watch.cover.querySelector('button')?.textContent).toBe('Retry');
    watch.dispose();
  });
});
