// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const OPEN = pr('31', { files: [{ path: 'src/a.ts', kind: 'modified', mapped: true }] });
const OTHER = pr('32', { files: [{ path: 'src/a.ts', kind: 'modified', mapped: true }] });
const mounted: ReturnType<typeof mountLanternView>[] = [];

const flush = () => new Promise((r) => setTimeout(r, 0));

function open(opts: ViewOptions = {}, data = mapOf({ nodes: [node('src/a.ts', 'service')], prs: [OPEN, OTHER] })) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, data, { pr: OPEN.id, ...opts });
  mounted.push(view);
  return { root, view };
}

const refreshButton = (root: HTMLElement) => root.querySelector('.lt-side [data-pr-refresh]') as HTMLButtonElement | null;
const rowNote = (root: HTMLElement) => root.querySelector('.lt-side .pr-refresh-row .pr-reasons-note')?.textContent ?? '';

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
});

describe('the Refresh button of the pull request view', () => {
  it('is not drawn without a handler', () => {
    const { root } = open();
    expect(refreshButton(root)).toBeNull();
  });

  it('sits in the pull request header, next to the other review controls, with its label', () => {
    const { root } = open({ onRefreshPrs: vi.fn(async () => ({ ok: true })) });
    expect(refreshButton(root)?.textContent).toBe('Refresh');
    expect(refreshButton(root)?.closest('.pr-head')).not.toBeNull();
  });

  it('shows a busy state while it runs and settles when it is done', async () => {
    let finish: (value: { ok: boolean }) => void = () => undefined;
    const onRefreshPrs = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => (finish = resolve)));
    const { root } = open({ onRefreshPrs });

    refreshButton(root)!.click();
    await flush();

    expect(onRefreshPrs).toHaveBeenCalledTimes(1);
    expect(refreshButton(root)?.disabled).toBe(true);
    expect(refreshButton(root)?.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton(root)?.textContent).toBe('Refreshing…');
    refreshButton(root)!.click();
    expect(onRefreshPrs).toHaveBeenCalledTimes(1);

    finish({ ok: true });
    await flush();

    expect(refreshButton(root)?.disabled).toBe(false);
    expect(refreshButton(root)?.textContent).toBe('Refresh');
    expect(rowNote(root)).toBe('');
  });

  it('shows the failure in the same place and lets it be tried again', async () => {
    const onRefreshPrs = vi.fn().mockResolvedValueOnce({ ok: false, error: 'could not resolve host' }).mockResolvedValueOnce({ ok: true });
    const { root } = open({ onRefreshPrs });

    refreshButton(root)!.click();
    await flush();

    expect(rowNote(root)).toBe('Could not refresh: could not resolve host');
    expect(root.querySelector('.pr-refresh-row')?.contains(refreshButton(root))).toBe(true);
    expect(refreshButton(root)?.disabled).toBe(false);

    refreshButton(root)!.click();
    await flush();

    expect(onRefreshPrs).toHaveBeenCalledTimes(2);
    expect(rowNote(root)).toBe('');
  });

  it('shows the failure of a handler that throws', async () => {
    const { root } = open({ onRefreshPrs: vi.fn().mockRejectedValue(new Error('no bridge')) });
    refreshButton(root)!.click();
    await flush();
    expect(rowNote(root)).toBe('Could not refresh: no bridge');
  });
});

describe('entering a pull request', () => {
  it('tells the host which pull request was entered, once per entering', () => {
    const onEnterPr = vi.fn();
    const { view } = open({ onEnterPr, pr: '' });
    expect(onEnterPr).not.toHaveBeenCalled();

    view.selectPr('32');
    view.selectPr('32');
    view.selectPr('31');

    expect(onEnterPr.mock.calls).toEqual([['32'], ['31']]);
  });

  it('does not report a local comparison, which has no remote to revalidate', () => {
    const onEnterPr = vi.fn();
    const local = pr('local:main..feat', { source: 'local', files: [{ path: 'src/a.ts', kind: 'modified', mapped: true }] });
    const { view } = open({ onEnterPr, pr: '' }, mapOf({ nodes: [node('src/a.ts', 'service')], prs: [local] }));
    view.selectPr(local.id);
    expect(onEnterPr).not.toHaveBeenCalled();
  });

  it('takes the data the host reloads after a change', () => {
    const { root, view } = open({ onEnterPr: vi.fn() });
    expect(root.querySelector('.lt-side .pr-title')?.textContent).toBe(OPEN.title);
    view.update(mapOf({ nodes: [node('src/a.ts', 'service')], prs: [{ ...OPEN, title: 'Renamed on the remote' }, OTHER] }));
    expect(root.querySelector('.lt-side .pr-title')?.textContent).toBe('Renamed on the remote');
  });
});
