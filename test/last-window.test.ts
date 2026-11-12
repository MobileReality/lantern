import { describe, expect, it, vi } from 'vitest';
import { createLastWindowHandler, desktopHostsTray, shouldQuitWhenAllWindowsClosed, trayReachable } from '../src/main/last-window';

describe('shouldQuitWhenAllWindowsClosed', () => {
  it('never quits on macOS, with or without a tray', () => {
    expect(shouldQuitWhenAllWindowsClosed({ platform: 'darwin', trayAvailable: true })).toBe(false);
    expect(shouldQuitWhenAllWindowsClosed({ platform: 'darwin', trayAvailable: false })).toBe(false);
  });

  it('quits on Windows only without a tray', () => {
    expect(shouldQuitWhenAllWindowsClosed({ platform: 'win32', trayAvailable: false })).toBe(true);
    expect(shouldQuitWhenAllWindowsClosed({ platform: 'win32', trayAvailable: true })).toBe(false);
  });

  it('quits on Linux only without a reachable tray', () => {
    expect(shouldQuitWhenAllWindowsClosed({ platform: 'linux', trayAvailable: false })).toBe(true);
    expect(shouldQuitWhenAllWindowsClosed({ platform: 'linux', trayAvailable: true })).toBe(false);
  });
});

describe('desktopHostsTray', () => {
  it.each(['KDE', 'XFCE', 'X-Cinnamon', 'MATE', 'Budgie:GNOME', 'Unity', 'Pantheon', 'ubuntu:KDE'])('knows %s hosts a tray', (desktop) => {
    expect(desktopHostsTray({ XDG_CURRENT_DESKTOP: desktop })).toBe(true);
  });

  it.each(['GNOME', 'ubuntu:GNOME', 'sway', ''])('does not trust %j', (desktop) => {
    expect(desktopHostsTray({ XDG_CURRENT_DESKTOP: desktop })).toBe(false);
  });

  it('does not trust an unset desktop', () => {
    expect(desktopHostsTray({})).toBe(false);
  });
});

describe('trayReachable', () => {
  it('is false without a tray on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) expect(trayReachable({ platform, trayCreated: false, env: { XDG_CURRENT_DESKTOP: 'KDE' } })).toBe(false);
  });

  it('trusts a created tray on Windows', () => {
    expect(trayReachable({ platform: 'win32', trayCreated: true, env: {} })).toBe(true);
  });

  it('needs a known tray desktop on Linux', () => {
    expect(trayReachable({ platform: 'linux', trayCreated: true, env: { XDG_CURRENT_DESKTOP: 'GNOME' } })).toBe(false);
    expect(trayReachable({ platform: 'linux', trayCreated: true, env: { XDG_CURRENT_DESKTOP: 'KDE' } })).toBe(true);
  });
});

describe('the window-all-closed handler', () => {
  function handler(overrides: Partial<Parameters<typeof createLastWindowHandler>[0]> = {}) {
    const quit = vi.fn();
    const run = createLastWindowHandler({ platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'GNOME' }, trayCreated: () => false, isQuitting: () => false, quit, ...overrides });
    return { run, quit };
  }

  it('quits on Linux without a tray', () => {
    const { run, quit } = handler();
    run();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('quits on Linux GNOME even though a tray object exists', () => {
    const { run, quit } = handler({ trayCreated: () => true });
    run();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('stays running on Linux KDE with a tray', () => {
    const { run, quit } = handler({ env: { XDG_CURRENT_DESKTOP: 'KDE' }, trayCreated: () => true });
    run();
    expect(quit).not.toHaveBeenCalled();
  });

  it('does not quit on macOS', () => {
    const { run, quit } = handler({ platform: 'darwin' });
    run();
    expect(quit).not.toHaveBeenCalled();
  });

  it('leaves a quit already in progress alone', () => {
    const { run, quit } = handler({ isQuitting: () => true });
    run();
    expect(quit).not.toHaveBeenCalled();
  });
});
