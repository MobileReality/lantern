import { describe, expect, it } from 'vitest';
import {
  TAB_TIMEOUT_MS,
  formatElapsed,
  initialTabLoad,
  navigatedTabLoad,
  observePage,
  serverView,
  shouldRestartServer,
  tabView,
  tickTabLoad,
  toPageKind,
} from '../src/renderer/lib/editorload';

const T0 = 1_000_000;

describe('observePage', () => {
  it('moves from connecting to downloading when serve-web shows its download page', () => {
    expect(observePage(initialTabLoad(T0), 'downloading', T0 + 500)).toEqual({ phase: 'downloading', since: T0 + 500 });
  });

  it('keeps the phase and its start time on a blank probe between self-reloads', () => {
    const s = observePage(initialTabLoad(T0), 'downloading', T0);
    expect(observePage(s, 'blank', T0 + 1500)).toBe(s);
  });

  it('keeps the start time when the same phase is observed again', () => {
    const s = observePage(initialTabLoad(T0), 'downloading', T0);
    expect(observePage(s, 'downloading', T0 + 3000)).toBe(s);
  });

  it('reaches ready only once the workbench is in the page', () => {
    const booting = observePage(initialTabLoad(T0), 'booting', T0);
    expect(booting.phase).toBe('starting');
    expect(observePage(booting, 'workbench', T0 + 10).phase).toBe('ready');
  });

  it('does not leave failed on its own', () => {
    const failed = tickTabLoad(initialTabLoad(T0), T0 + TAB_TIMEOUT_MS.connecting + 1);
    expect(observePage(failed, 'workbench', T0 + TAB_TIMEOUT_MS.connecting + 2)).toBe(failed);
  });
});

describe('tickTabLoad', () => {
  it('stays put inside the phase timeout', () => {
    const s = initialTabLoad(T0);
    expect(tickTabLoad(s, T0 + TAB_TIMEOUT_MS.connecting)).toBe(s);
  });

  it('fails a stuck download after its timeout and remembers where it stalled', () => {
    const s = observePage(initialTabLoad(T0), 'downloading', T0);
    const now = T0 + TAB_TIMEOUT_MS.downloading + 1;
    expect(tickTabLoad(s, now)).toEqual({ phase: 'failed', since: now, failedFrom: 'downloading' });
  });

  it('never times out a ready editor', () => {
    const ready = observePage(initialTabLoad(T0), 'workbench', T0);
    expect(tickTabLoad(ready, T0 + TAB_TIMEOUT_MS.downloading * 10)).toBe(ready);
  });
});

describe('navigatedTabLoad', () => {
  it('restarts the watch when a live editor navigates', () => {
    const ready = observePage(initialTabLoad(T0), 'workbench', T0);
    expect(navigatedTabLoad(ready, T0 + 99)).toEqual(initialTabLoad(T0 + 99));
  });

  it('ignores the download page reloading itself so the timeout still fires', () => {
    const s = observePage(initialTabLoad(T0), 'downloading', T0);
    expect(navigatedTabLoad(s, T0 + 1500)).toBe(s);
  });
});

describe('shouldRestartServer', () => {
  it('restarts only when no other editor is live', () => {
    expect(shouldRestartServer([])).toBe(true);
    expect(shouldRestartServer(['failed', 'downloading'])).toBe(true);
    expect(shouldRestartServer(['ready', 'failed'])).toBe(false);
  });
});

describe('toPageKind', () => {
  it('accepts known probe results and maps anything else to blank', () => {
    expect(toPageKind('downloading')).toBe('downloading');
    expect(toPageKind('workbench')).toBe('workbench');
    expect(toPageKind('toString')).toBe('blank');
    expect(toPageKind(42)).toBe('blank');
    expect(toPageKind(undefined)).toBe('blank');
  });
});

describe('formatElapsed', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(42_900)).toBe('0:42');
    expect(formatElapsed(125_000)).toBe('2:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('serverView', () => {
  it('names the download phase and passes the percentage through', () => {
    const v = serverView({ phase: 'download', progress: 'Downloading the VS Code server…', percent: 40 });
    expect(v.title).toBe('Downloading VS Code Server…');
    expect(v.percent).toBe(40);
    expect(v.failed).toBe(false);
  });

  it('turns the error phase into a failure with the server message', () => {
    const v = serverView({ phase: 'error', progress: 'The VS Code server didn’t start within 5 minutes.' });
    expect(v.failed).toBe(true);
    expect(v.detail).toMatch(/5 minutes/);
  });

  it('falls back to a starting view for probe and unknown phases', () => {
    expect(serverView({ phase: 'probe' }).title).toBe('Starting the editor server…');
    expect(serverView({}).percent).toBeNull();
  });
});

describe('tabView', () => {
  it('calls a tab-level download an update and names the project', () => {
    const v = tabView(observePage(initialTabLoad(T0), 'downloading', T0), 'lantern');
    expect(v.title).toBe('Updating VS Code Server…');
    expect(v.detail).toContain('lantern');
  });

  it('explains which stage failed', () => {
    const s = tickTabLoad(observePage(initialTabLoad(T0), 'downloading', T0), T0 + TAB_TIMEOUT_MS.downloading + 1);
    const v = tabView(s, 'lantern');
    expect(v.failed).toBe(true);
    expect(v.title).toBe('The VS Code Server update stalled');
  });
});
