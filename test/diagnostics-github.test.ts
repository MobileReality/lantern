import { describe, expect, it, vi } from 'vitest';
import { MAX_ISSUE_URL_CHARS, buildIssueUrl, composeIssue, isIssueUrl, planIssue } from '../src/main/diagnostics/github';
import { registerDiagnosticsIpc } from '../src/main/diagnostics/ipc';
import { formatReport } from '../src/main/diagnostics/report';
import { parseRendererReport, parseReportRequest } from '../src/shared/diagnostics';
import { HOME, PROJECT, entry, makeLogDir, reportContext, startService } from './helpers/diagnostics-world';

const decode = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe('the GitHub issue link', () => {
  it('always points at the Lantern repository on github.com and fills the bug template, title and body', () => {
    const url = buildIssueUrl('[Bug] Editor failed & "quoted" 100%', 'line one\nline two #3');
    expect(url.startsWith('https://github.com/MobileReality/lantern/issues/new?')).toBe(true);
    expect(decode(url)).toEqual({ template: 'bug_report.md', labels: 'bug', title: '[Bug] Editor failed & "quoted" 100%', body: 'line one\nline two #3' });
    expect(url).not.toContain(' ');
    expect(url).toContain('%0A');
  });

  it('encodes characters that could change the link’s meaning', () => {
    const url = buildIssueUrl('t', 'https://evil.example/?x=1&y=2#frag');
    expect(new URL(url).host).toBe('github.com');
    expect(new URL(url).hash).toBe('');
    expect(decode(url).body).toBe('https://evil.example/?x=1&y=2#frag');
  });

  it('accepts only the fixed issue page: https, github.com, that repository', () => {
    expect(isIssueUrl(buildIssueUrl('a', 'b'))).toBe(true);
    for (const bad of [
      'http://github.com/MobileReality/lantern/issues/new',
      'https://github.com.evil.example/MobileReality/lantern/issues/new',
      'https://evil.example/MobileReality/lantern/issues/new',
      'https://user:pw@github.com/MobileReality/lantern/issues/new',
      'https://github.com:8443/MobileReality/lantern/issues/new',
      'https://github.com/other/repo/issues/new',
      'https://github.com/MobileReality/lantern/issues/new#x',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isIssueUrl(bad), bad).toBe(false);
    }
  });
});

describe('a report that fits in a link', () => {
  it('is carried whole, in the sections of the bug template, with nothing copied', () => {
    const context = reportContext();
    const { draft, environment } = composeIssue([entry({ message: 'The VS Code server exited with code 1', source: 'editor-server', exitCode: 1 })], context);
    const plan = planIssue(draft, environment);
    expect(plan).toMatchObject({ truncated: false, clipboard: null });
    expect(plan.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_CHARS);
    const { title, body } = decode(plan.url);
    expect(title).toBe('[Bug] The VS Code server exited with code 1');
    expect(body).toContain('## What happened');
    expect(body).toContain('- Lantern version: 0.2.2');
    expect(body).toContain('- OS: win32 x64');
    expect(body).toContain('- Electron: 45.2.2');
    expect(body).toContain('## Diagnostics');
    expect(body).toContain('exit code 1');
  });

  it('has no home folders, project folders or tokens, even if one reached the entry unredacted', () => {
    const leaky = entry({
      message: `Failed in ${PROJECT}/src for ${HOME}/.ssh`,
      detail: `${HOME}/.config\nhttp://127.0.0.1:9888/?tkn=topsecretvalue\ncode serve-web --connection-token deadbeefdeadbeef\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\nghp_abcdefghijklmnopqrstuvwxyz0123`,
    });
    const { draft, environment } = composeIssue([leaky], reportContext());
    const everything = JSON.stringify(decode(planIssue(draft, environment).url)) + draft.full + draft.summary + draft.title;
    for (const secret of [HOME, 'jane', 'secret-client', 'topsecretvalue', 'deadbeefdeadbeef', 'abcdefghijklmnopqrstuvwxyz', 'ghp_']) expect(everything, secret).not.toContain(secret);
    expect(everything).toContain('<project>');
  });
});

describe('a report too long for a link', () => {
  const longEntries = Array.from({ length: 30 }, (_v, i) => entry({ id: `e${i}`, message: `Failure number ${i}`, detail: `stack line ${'x'.repeat(400)}\n`.repeat(8) }));

  it('puts only a short summary in the link and hands the full report over for the clipboard', () => {
    const { draft, environment } = composeIssue(longEntries, reportContext());
    expect(draft.full.length).toBeGreaterThan(MAX_ISSUE_URL_CHARS);
    const plan = planIssue(draft, environment);
    expect(plan.truncated).toBe(true);
    expect(plan.clipboard).toBe(draft.full);
    expect(plan.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_CHARS);
    expect(isIssueUrl(plan.url)).toBe(true);
    const { body } = decode(plan.url);
    expect(body).toContain('copied to your clipboard');
    expect(body).toContain('Failure number 29');
    expect(body).not.toContain('stack line');
  });

  it('still fits when even the summary is too long', () => {
    const huge = entry({ message: 'm'.repeat(1900) });
    const { draft, environment } = composeIssue([huge, huge, huge, huge], reportContext());
    const plan = planIssue({ ...draft, summary: 's'.repeat(20_000) }, environment);
    expect(plan.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_CHARS);
    expect(plan.truncated).toBe(true);
  });

  it('keeps the report redacted when it goes to the clipboard', () => {
    const { draft } = composeIssue([...longEntries, entry({ message: `Opened ${PROJECT}` })], reportContext());
    expect(draft.full).not.toContain('secret-client');
  });
});

describe('formatting a report', () => {
  it('lists the environment and each entry with exit code, signal and indented detail', () => {
    const text = formatReport([entry({ exitCode: 3, signal: 'SIGTERM', detail: 'line a\nline b' })], reportContext());
    expect(text).toContain('Lantern version: 0.2.2');
    expect(text).toContain('Error · Main process: Something failed');
    expect(text).toContain('exit code 3 · signal SIGTERM · Lantern 0.2.2');
    expect(text).toContain('    line b');
  });

  it('says so when there is nothing to report', () => {
    expect(formatReport([], reportContext())).toContain('No entries recorded.');
  });
});

describe('the requests the window may send', () => {
  it('accepts a well-formed window error and trims it to the allowed size', () => {
    const report = parseRendererReport({ kind: 'error', message: 'x'.repeat(5000), stack: 'y'.repeat(20_000), extra: 'ignored' });
    expect(report?.kind).toBe('error');
    expect(report?.message.length).toBeLessThanOrEqual(2000);
    expect(report?.stack?.length).toBeLessThanOrEqual(8000);
    expect(report).not.toHaveProperty('extra');
  });

  it.each([null, undefined, 'text', 42, [], {}, { kind: 'error' }, { message: 'no kind' }, { kind: 'other', message: 'm' }, { kind: 'error', message: '  ' }, { kind: 'error', message: 5 }, { kind: 'error', message: 'm', stack: 7 }])(
    'rejects a malformed window error: %j',
    (payload) => {
      expect(parseRendererReport(payload)).toBeNull();
    },
  );

  it('accepts no request, an entry id or the crash flag, and nothing else', () => {
    expect(parseReportRequest(undefined)).toEqual({});
    expect(parseReportRequest({ entryId: 'abc' })).toEqual({ entryId: 'abc' });
    expect(parseReportRequest({ crash: true })).toEqual({ crash: true });
    for (const bad of ['abc', 7, [], { entryId: '' }, { entryId: 5 }, { entryId: 'x'.repeat(65) }, { crash: 'yes' }]) expect(parseReportRequest(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('the diagnostics IPC handlers', () => {
  function ipcWorld() {
    const service = startService(makeLogDir());
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const writeClipboard = vi.fn();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    registerDiagnosticsIpc({
      handle: (channel, listener) => void handlers.set(channel, listener),
      fromWorkspace: (fn) => fn,
      service,
      writeClipboard,
      openExternal,
    });
    const callFrom = (sender: ReturnType<typeof viewer>, channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender }, ...args);
    const call = (channel: string, ...args: unknown[]) => callFrom(viewer(), channel, ...args);
    return { service, call, callFrom, writeClipboard, openExternal };
  }
  const viewer = () => ({ isDestroyed: () => false, send: vi.fn(), once: vi.fn() });

  it('stores a window error as an entry of the window source', async () => {
    const { service, call } = ipcWorld();
    expect(await call('diagnostics:report', { kind: 'unhandledrejection', message: `failed at ${HOME}/a.js`, stack: 'stack' })).toEqual({ ok: true });
    expect(service.listing().entries.at(-1)).toMatchObject({ source: 'renderer', severity: 'error', message: 'failed at ~/a.js', detail: 'stack' });
  });

  it('rejects a malformed window error and records nothing', async () => {
    const { service, call } = ipcWorld();
    const before = service.listing().entries.length;
    for (const bad of [null, 'text', { kind: 'error' }, { kind: 'x', message: 'm' }, { kind: 'error', message: { a: 1 } }]) expect(await call('diagnostics:report', bad)).toEqual({ ok: false });
    expect(service.listing().entries).toHaveLength(before);
  });

  it('opens the issue page in the browser with a link it built itself, never one the window sent', async () => {
    const { service, call, openExternal, writeClipboard } = ipcWorld();
    service.record({ source: 'editor-server', severity: 'error', message: 'The VS Code server exited with code 1', exitCode: 1 });
    const id = service.listing().entries.at(-1)!.id;
    expect(await call('diagnostics:github', { entryId: id, url: 'https://evil.example' })).toEqual({ ok: true, copied: false, truncated: false });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(isIssueUrl(openExternal.mock.calls[0][0])).toBe(true);
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('copies the full report and opens a short link when the report is too long', async () => {
    const { service, call, openExternal, writeClipboard } = ipcWorld();
    for (let i = 0; i < 20; i++) service.record({ source: 'main', severity: 'error', message: `Failure ${i}`, detail: 'z'.repeat(900) });
    expect(await call('diagnostics:github', {})).toEqual({ ok: true, copied: true, truncated: true });
    expect(writeClipboard.mock.calls[0][0]).toContain('Failure 19');
    expect(openExternal.mock.calls[0][0].length).toBeLessThanOrEqual(MAX_ISSUE_URL_CHARS);
  });

  it('refuses an unknown entry or a malformed request without opening anything', async () => {
    const { call, openExternal } = ipcWorld();
    expect(await call('diagnostics:github', { entryId: 'nope' })).toEqual({ ok: false, copied: false, truncated: false });
    expect(await call('diagnostics:github', 'junk')).toEqual({ ok: false, copied: false, truncated: false });
    expect(await call('diagnostics:copy', { entryId: 'nope' })).toEqual({ ok: false, count: 0 });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('copies a redacted report of the recent entries', async () => {
    const { service, call, writeClipboard } = ipcWorld();
    service.record({ source: 'main', severity: 'error', message: `bad ${PROJECT}` });
    const outcome = (await call('diagnostics:copy', {})) as { ok: boolean; count: number };
    expect(outcome.ok).toBe(true);
    expect(outcome.count).toBeGreaterThan(1);
    expect(writeClipboard.mock.calls[0][0]).toContain('bad <project>');
  });

  it('reports the crash of the previous run from the crash notice and reports it only on request', async () => {
    const dir = makeLogDir();
    const first = startService(dir);
    first.record({ source: 'main', severity: 'fatal', message: 'Error: boom' });
    const second = startService(dir);
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const openExternal = vi.fn();
    registerDiagnosticsIpc({ handle: (c, l) => void handlers.set(c, l), fromWorkspace: (fn) => fn, service: second, writeClipboard: vi.fn(), openExternal });
    expect(await handlers.get('diagnostics:notice')!({})).toMatchObject({ session: first.session, reason: 'fatal' });
    expect(openExternal).not.toHaveBeenCalled();
    await handlers.get('diagnostics:github')!({}, { crash: true });
    expect(decode(openExternal.mock.calls[0][0]).title).toBe('[Bug] Lantern closed unexpectedly');
    expect(decode(openExternal.mock.calls[0][0]).body).toContain('Error: boom');
    await handlers.get('diagnostics:dismiss')!({});
    expect(await handlers.get('diagnostics:notice')!({})).toBeNull();
  });

  it('pushes new entries to a window that is watching, until it stops', () => {
    const { service, callFrom } = ipcWorld();
    const win = viewer();
    const watch = (on: boolean) => callFrom(win, 'diagnostics:watch', on);
    watch(true);
    service.record({ source: 'main', severity: 'warning', message: 'live one' });
    expect(win.send).toHaveBeenCalledWith('diagnostics:update', expect.objectContaining({ message: 'live one' }));
    watch(false);
    service.record({ source: 'main', severity: 'warning', message: 'live two' });
    expect(win.send).toHaveBeenCalledTimes(1);
  });
});
