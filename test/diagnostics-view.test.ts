// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrashNotice, DiagnosticEntry, DiagnosticsListing } from '../src/shared/diagnostics';
import { ANY, applyFilter, mergeEntry, severityCounts } from '../src/renderer/lib/diagnostics-model';
import { installRendererCapture } from '../src/renderer/lib/diagnostics-capture';
import { entry } from './helpers/diagnostics-world';

const HTML = fs.readFileSync(path.join(__dirname, '../src/renderer/workspace.html'), 'utf8');

const entries = (): DiagnosticEntry[] => [
  entry({ id: 'a', severity: 'info', source: 'app', message: 'Lantern started', session: 'old' }),
  entry({ id: 'b', severity: 'error', source: 'editor-server', message: 'The VS Code server exited with code 1', exitCode: 1, detail: 'Command: code serve-web\nLast output:\nboom', session: 'old' }),
  entry({ id: 'c', severity: 'warning', source: 'main', message: 'slow', session: 'now' }),
  entry({ id: 'd', severity: 'fatal', source: 'main', message: 'Error: boom', session: 'now' }),
];
const listing = (): DiagnosticsListing => ({ entries: entries(), session: 'now' });

describe('the diagnostics list model', () => {
  it('filters by severity and source and shows the newest first', () => {
    expect(applyFilter(entries(), { severity: ANY, source: ANY }).map((e) => e.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(applyFilter(entries(), { severity: 'error', source: ANY }).map((e) => e.id)).toEqual(['b']);
    expect(applyFilter(entries(), { severity: ANY, source: 'main' }).map((e) => e.id)).toEqual(['d', 'c']);
    expect(applyFilter(entries(), { severity: 'error', source: 'main' })).toEqual([]);
  });

  it('adds a pushed entry once and counts severities', () => {
    const more = mergeEntry(entries(), entry({ id: 'e', severity: 'error' }));
    expect(more.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(mergeEntry(more, entry({ id: 'e' }))).toBe(more);
    expect(severityCounts(more)).toEqual({ info: 1, warning: 1, error: 2, fatal: 1 });
  });
});

function loadWorkspaceHtml() {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.innerHTML = doc.body.innerHTML;
}

async function bootView() {
  vi.resetModules();
  loadWorkspaceHtml();
  let push: (entry: DiagnosticEntry) => void = () => {};
  const bridge = {
    diagnosticsWatch: vi.fn().mockResolvedValue(listing()),
    diagnosticsCopy: vi.fn().mockResolvedValue({ ok: true, count: 4 }),
    diagnosticsGithub: vi.fn().mockResolvedValue({ ok: true, copied: false, truncated: false }),
    onDiagnosticsUpdate: vi.fn((cb) => (push = cb)),
  };
  window.ccmws = bridge as unknown as Window['ccmws'];
  const { openDiagnostics } = await import('../src/renderer/features/diagnostics');
  return { bridge, open: () => openDiagnostics(), push: (e: DiagnosticEntry) => push(e) };
}

const modal = () => document.getElementById('diagnostics-modal')!;
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.dg-row')];
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.dg-button')].find((b) => b.textContent === label)!;
const choose = (label: string, value: string) => {
  const field = [...document.querySelectorAll('.dg-field')].find((f) => f.textContent?.startsWith(label))!;
  const select = field.querySelector('select')!;
  select.value = value;
  select.dispatchEvent(new Event('change'));
};

describe('the Diagnostics view', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('stays closed and watches nothing until it is opened', async () => {
    const { bridge } = await bootView();
    expect(modal().classList.contains('hidden')).toBe(true);
    expect(bridge.diagnosticsWatch).not.toHaveBeenCalled();
  });

  it('lists the log newest first and marks entries of an earlier run', async () => {
    const { open, bridge } = await bootView();
    await open();
    expect(bridge.diagnosticsWatch).toHaveBeenCalledWith(true);
    expect(rows().map((r) => r.querySelector('.dg-message')!.textContent)).toEqual(['Error: boom', 'slow', 'The VS Code server exited with code 1', 'Lantern started']);
    expect(rows()[3].textContent).toContain('earlier run');
    expect(rows()[0].textContent).not.toContain('earlier run');
    expect(document.querySelector('.dg-counts')!.textContent).toBe('1 crash · 1 error · 1 warning');
  });

  it('shows new entries as they are pushed, without a reload', async () => {
    const { open, push } = await bootView();
    await open();
    push(entry({ id: 'live', severity: 'error', message: 'A request on lantern:load failed' }));
    expect(rows()).toHaveLength(5);
    expect(rows()[0].querySelector('.dg-message')!.textContent).toBe('A request on lantern:load failed');
  });

  it('filters by severity and by source', async () => {
    const { open } = await bootView();
    await open();
    choose('Severity', 'error');
    expect(rows()).toHaveLength(1);
    choose('Severity', ANY);
    choose('Source', 'main');
    expect(rows()).toHaveLength(2);
    choose('Severity', 'info');
    expect(document.querySelector('.dg-empty')!.textContent).toBe('No entries match these filters.');
  });

  it('shows the details of the selected entry', async () => {
    const { open } = await bootView();
    await open();
    rows()[2].click();
    const detail = document.querySelector('.dg-detail')!;
    expect(detail.querySelector('.dg-detail-title')!.textContent).toBe('The VS Code server exited with code 1');
    expect(detail.textContent).toContain('Exit code');
    expect(detail.textContent).toContain('An earlier run');
    expect(detail.querySelector('.dg-text')!.textContent).toContain('Last output:\nboom');
  });

  it('copies a report and tells the user what it holds', async () => {
    const { open, bridge } = await bootView();
    await open();
    button('Copy report').click();
    await vi.waitFor(() => expect(document.querySelector('.dg-status')!.textContent).toContain('Copied a report of 4 entries'));
    expect(bridge.diagnosticsCopy).toHaveBeenCalledWith({});
  });

  it('opens GitHub for the whole log or for one entry and says that nothing is sent by itself', async () => {
    const { open, bridge } = await bootView();
    await open();
    button('Report on GitHub').click();
    await vi.waitFor(() => expect(document.querySelector('.dg-status')!.textContent).toContain('nothing is sent until you submit'));
    expect(bridge.diagnosticsGithub).toHaveBeenLastCalledWith({});
    rows()[2].click();
    button('Report this on GitHub').click();
    await vi.waitFor(() => expect(bridge.diagnosticsGithub).toHaveBeenLastCalledWith({ entryId: 'b' }));
  });

  it('tells the user to paste when the report went to the clipboard', async () => {
    const { open, bridge } = await bootView();
    bridge.diagnosticsGithub.mockResolvedValue({ ok: true, copied: true, truncated: true });
    await open();
    button('Report on GitHub').click();
    await vi.waitFor(() => expect(document.querySelector('.dg-status')!.textContent).toContain('Paste it into the issue'));
  });

  it('stops watching when closed', async () => {
    const { open, bridge } = await bootView();
    await open();
    document.getElementById('diagnostics-close')!.click();
    expect(modal().classList.contains('hidden')).toBe(true);
    expect(bridge.diagnosticsWatch).toHaveBeenLastCalledWith(false);
  });
});

describe('the notice after a crash', () => {
  const notice: CrashNotice = { session: 'old', time: '2026-11-10T10:00:00.000Z', reason: 'unclean-exit' };

  async function boot(pending: CrashNotice | null) {
    vi.resetModules();
    loadWorkspaceHtml();
    const actions = {
      notice: vi.fn().mockResolvedValue(pending),
      github: vi.fn().mockResolvedValue({ ok: true, copied: false }),
      dismiss: vi.fn().mockResolvedValue(true),
    };
    const { showCrashNotice } = await import('../src/renderer/features/diagnostics-notice');
    await showCrashNotice(actions);
    return actions;
  }
  const host = () => document.getElementById('crash-notice')!;

  it('stays hidden when the last run ended normally', async () => {
    await boot(null);
    expect(host().classList.contains('hidden')).toBe(true);
  });

  it('is shown once, never opens the browser by itself, and can be dismissed', async () => {
    const actions = await boot(notice);
    expect(host().classList.contains('hidden')).toBe(false);
    expect(host().textContent).toContain('Lantern closed unexpectedly last time');
    expect(actions.github).not.toHaveBeenCalled();
    document.getElementById('crash-notice-dismiss')!.click();
    expect(host().classList.contains('hidden')).toBe(true);
    expect(actions.dismiss).toHaveBeenCalledTimes(1);
  });

  it('reports on GitHub only when asked, and then does not show again', async () => {
    const actions = await boot(notice);
    document.getElementById('crash-notice-report')!.click();
    await vi.waitFor(() => expect(actions.github).toHaveBeenCalledWith({ crash: true }));
    await vi.waitFor(() => expect(actions.dismiss).toHaveBeenCalled());
    expect(document.getElementById('crash-notice-text')!.textContent).toContain('nothing is sent until you submit');
  });
});

describe('forwarding window errors', () => {
  function target() {
    const listeners = new Map<string, (event: any) => void>();
    return { addEventListener: (type: string, fn: (event: any) => void) => void listeners.set(type, fn), fire: (type: string, event: object) => listeners.get(type)!(event) };
  }

  it('forwards an error event with its stack and an unhandled rejection', () => {
    const win = target();
    const report = vi.fn().mockResolvedValue({ ok: true });
    installRendererCapture(win as unknown as Window, report);
    win.fire('error', { error: new Error('render broke'), message: 'render broke' });
    win.fire('unhandledrejection', { reason: new TypeError('nope') });
    win.fire('unhandledrejection', { reason: 'plain text' });
    expect(report.mock.calls[0][0]).toMatchObject({ kind: 'error', message: 'render broke' });
    expect(report.mock.calls[0][0].stack).toContain('render broke');
    expect(report.mock.calls[1][0]).toMatchObject({ kind: 'unhandledrejection', message: 'nope' });
    expect(report.mock.calls[2][0]).toMatchObject({ kind: 'unhandledrejection', message: 'plain text' });
  });

  it('ignores the harmless resize notice and survives a failing report', () => {
    const win = target();
    const report = vi.fn(() => Promise.reject(new Error('channel closed')));
    installRendererCapture(win as unknown as Window, report);
    win.fire('error', { message: 'ResizeObserver loop completed with undelivered notifications.' });
    expect(report).not.toHaveBeenCalled();
    expect(() => win.fire('error', { message: 'real problem', filename: 'app.js', lineno: 3, colno: 4 })).not.toThrow();
    expect(report.mock.calls[0]).toEqual([{ kind: 'error', message: 'real problem', stack: 'app.js:3:4' }]);
  });
});
