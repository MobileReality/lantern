import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate } from '../src/main/app-menu';
import { createUpdateController, registerUpdateIpc } from '../src/main/updater/controller';
import { lostItems, restartDialog, resultDialog } from '../src/main/updater/dialogs';
import { squirrelUpdater } from '../src/main/updater/native';
import { updateNoticeView } from '../src/renderer/lib/update-notice-view';
import { defaultBindings, resolveKeymap } from '../src/shared/commands/keymap';
import { SETTING_DEFAULTS, SETTINGS } from '../src/shared/settings-registry';
import { isValidValue } from '../src/main/settings-model';
import { UPDATE_ACTION_CHANNEL, UPDATE_GET_CHANNEL, parseUpdateAction } from '../src/shared/updates';
import { BUSY, FEED_NEWER, LATEST_NEWER, flush, updaterWorld } from './helpers/updater-world';

describe('the Squirrel adapter', () => {
  function adapter() {
    const emitter = new EventEmitter();
    const autoUpdater = Object.assign(emitter, { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn() });
    return { autoUpdater, native: squirrelUpdater(autoUpdater) };
  }

  it('sets a JSON feed, checks and installs through the Electron updater', () => {
    const { autoUpdater, native } = adapter();
    native.setFeedUrl('https://update.electronjs.org/x');
    native.checkForUpdates();
    native.quitAndInstall();
    expect(autoUpdater.setFeedURL).toHaveBeenCalledExactlyOnceWith({ url: 'https://update.electronjs.org/x', serverType: 'json' });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('turns update-downloaded into the release name, update-not-available into a call and error into its message', () => {
    const { autoUpdater, native } = adapter();
    const downloaded = vi.fn();
    const notAvailable = vi.fn();
    const failed = vi.fn();
    native.onDownloaded(downloaded);
    native.onNotAvailable(notAvailable);
    native.onError(failed);
    autoUpdater.emit('update-downloaded', {}, 'notes', 'v0.3.0', new Date(), 'https://x');
    autoUpdater.emit('update-downloaded', {}, 'notes');
    autoUpdater.emit('update-not-available');
    autoUpdater.emit('error', new Error('boom'));
    expect(downloaded.mock.calls).toEqual([['v0.3.0'], ['']]);
    expect(notAvailable).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledExactlyOnceWith('boom');
  });
});

describe('the Check for Updates… menu item', () => {
  const keys = resolveKeymap(defaultBindings()).byCommand;
  const submenuOf = (item: MenuItemConstructorOptions) => item.submenu as MenuItemConstructorOptions[];
  const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => item.role ?? item.type ?? item.label);

  it('sits under About in the macOS app menu and runs the check', () => {
    const check = vi.fn();
    const [app] = appMenuTemplate('darwin', 'Lantern', vi.fn(), keys, check);
    expect(labels(submenuOf(app)).slice(0, 4)).toEqual(['about', 'Check for Updates…', 'separator', 'Command palette…']);
    (submenuOf(app)[1].click as () => void)();
    expect(check).toHaveBeenCalledOnce();
  });

  it.each(['win32', 'linux'] as const)('sits in the File menu on %s, above Quit', (platform) => {
    const [file] = appMenuTemplate(platform, 'Lantern', vi.fn(), keys, vi.fn());
    expect(labels(submenuOf(file))).toEqual(['Command palette…', 'Settings…', 'separator', 'Check for Updates…', 'separator', 'quit']);
  });

  it('is absent when no check is given', () => {
    const [app] = appMenuTemplate('darwin', 'Lantern', vi.fn(), keys);
    expect(labels(submenuOf(app))).not.toContain('Check for Updates…');
  });
});

describe('the "Check for automatically" setting', () => {
  it('is on by default and is a boolean', () => {
    const setting = SETTINGS.find((entry) => entry.key === 'updates.checkAutomatically');
    expect(setting?.category).toMatchObject({ id: 'updates', title: 'Updates' });
    expect(SETTING_DEFAULTS['updates.checkAutomatically']).toBe(true);
    expect(isValidValue(setting!.schema, false)).toBe(true);
    expect(isValidValue(setting!.schema, 'off')).toBe(false);
  });
});

describe('the result of a manual check', () => {
  const shown = (kind: Parameters<typeof resultDialog>[0]) => resultDialog(kind, '0.2.2');

  it('says Lantern is up to date, with the version', () => {
    expect(shown({ kind: 'up-to-date' })).toMatchObject({ message: 'Lantern is up to date', detail: 'You have version 0.2.2.' });
  });

  it('says when automatic checks are off and how to turn them on', () => {
    expect(shown({ kind: 'disabled' }).detail).toContain('Check for updates automatically');
  });

  it('says a build from source never updates itself', () => {
    expect(shown({ kind: 'not-packaged' }).message).toContain('installed builds');
  });

  it('offers the release page for a version Lantern cannot install itself', () => {
    const dialog = shown({ kind: 'available', version: '0.4.0', url: 'https://github.com/MobileReality/lantern/releases/tag/v0.4.0' });
    expect(dialog.message).toBe('Lantern 0.4.0 is available');
    expect(dialog.buttons.map((button) => button.action)).toEqual(['view', 'close']);
    expect(dialog.viewUrl).toBe('https://github.com/MobileReality/lantern/releases/tag/v0.4.0');
  });

  it('offers the releases page when the feed has nothing for this build', () => {
    expect(shown({ kind: 'unavailable' }).viewUrl).toBe('https://github.com/MobileReality/lantern/releases');
  });

  it('offers Restart now for a downloaded update', () => {
    expect(shown({ kind: 'ready', version: '0.3.0' }).buttons.map((button) => button.action)).toEqual(['restart', 'close']);
  });

  it('describes a failed check in words, with nothing to retry and nothing alarming', () => {
    const dialog = shown({ kind: 'failed' });
    expect(dialog.message).toBe('Could not check for updates');
    expect(dialog.buttons.map((button) => button.action)).toEqual(['close']);
  });
});

describe('the restart confirmation', () => {
  it('names every kind of thing that would be lost', () => {
    const items = lostItems({ agentRunning: true, terminals: 1, running: 3, unknown: true });
    expect(items).toEqual([
      'an AI assistant run started by Lantern',
      '1 editor terminal',
      '3 running processes',
      'anything running in the editor, which Lantern could not check',
    ]);
  });

  it('puts the list in the detail and defaults to cancelling', () => {
    const dialog = restartDialog({ agentRunning: false, terminals: 2, running: 0, unknown: false });
    expect(dialog.detail).toBe('Restarting ends 2 editor terminals. Whatever is running in them stops.');
    expect(dialog.cancel).toBe('Cancel');
  });
});

describe('the update controller', () => {
  function controller(world: ReturnType<typeof updaterWorld>, action: 'close' | 'view' | 'restart') {
    const showResult = vi.fn(async () => action);
    const openExternal = vi.fn();
    const check = createUpdateController({ updater: world.updater, version: '0.2.2', showResult, openExternal });
    return { check, showResult, openExternal };
  }

  it('shows the result of the check', async () => {
    const world = updaterWorld({ status: 204 });
    const { check, showResult } = controller(world, 'close');
    await check();
    expect(showResult).toHaveBeenCalledWith(expect.objectContaining({ message: 'Lantern is up to date' }));
  });

  it('shows a failed check as a plain message and logs it', async () => {
    const world = updaterWorld({ status: 500 });
    const { check, showResult } = controller(world, 'close');
    await check();
    expect(showResult).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not check for updates' }));
    expect(world.logs).toHaveLength(1);
  });

  it('opens the release page when asked, and only a release page', async () => {
    const world = updaterWorld({ platform: 'win32', native: null, status: 200, body: LATEST_NEWER });
    const { check, openExternal } = controller(world, 'view');
    await check();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://github.com/MobileReality/lantern/releases/tag/v0.4.0');
  });

  it('restarts through the confirmation when asked to restart a downloaded update', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER, activity: BUSY });
    world.updater.start();
    await world.updater.check();
    world.handlers.downloaded?.('v0.3.0');
    await flush();
    const { check } = controller(world, 'restart');
    await check();
    expect(world.confirmRestart).toHaveBeenCalledOnce();
  });

  it('makes no request while automatic checks are off, and says so', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER });
    world.state.enabled = false;
    const { check, showResult } = controller(world, 'close');
    await check();
    expect(world.requests).toEqual([]);
    expect(showResult).toHaveBeenCalledWith(expect.objectContaining({ message: 'Automatic update checks are off' }));
  });
});

describe('the update IPC', () => {
  function registered() {
    const world = updaterWorld({ platform: 'win32', native: null, status: 200, body: LATEST_NEWER });
    const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
    registerUpdateIpc({ handle: (channel, listener) => handlers.set(channel, listener), fromWorkspace: (fn) => fn, updater: world.updater });
    return { world, handlers };
  }

  it('answers the current notice', async () => {
    const { world, handlers } = registered();
    expect(await handlers.get(UPDATE_GET_CHANNEL)!({})).toBeNull();
    await world.updater.check();
    expect(await handlers.get(UPDATE_GET_CHANNEL)!({})).toEqual({ kind: 'available', version: '0.4.0' });
  });

  it('runs a known action and ignores anything else', async () => {
    const { world, handlers } = registered();
    await world.updater.check();
    await handlers.get(UPDATE_ACTION_CHANNEL)!({}, 'open-anything');
    expect(world.openRelease).not.toHaveBeenCalled();
    expect(await handlers.get(UPDATE_ACTION_CHANNEL)!({}, 'dismiss')).toBeNull();
  });

  it('parses only the four actions', () => {
    expect(['restart', 'later', 'view', 'dismiss'].map(parseUpdateAction)).toEqual(['restart', 'later', 'view', 'dismiss']);
    expect([42, null, 'view ', '', { action: 'view' }].map(parseUpdateAction)).toEqual([null, null, null, null, null]);
  });
});

describe('the notice text', () => {
  it('says "Update ready: restart when your sessions finish" while it waits', () => {
    expect(updateNoticeView({ kind: 'ready', version: '0.3.0', waiting: true })).toMatchObject({
      title: 'Update ready: restart when your sessions finish',
      primary: { action: 'restart', label: 'Restart now' },
      secondary: { action: 'later' },
    });
  });

  it('says Update ready when nothing waits for sessions', () => {
    expect(updateNoticeView({ kind: 'ready', version: '0.3.0', waiting: false }).title).toBe('Update ready');
  });

  it('says "Lantern X is available" with a button that opens the release page', () => {
    expect(updateNoticeView({ kind: 'available', version: '0.4.0' })).toMatchObject({
      title: 'Lantern 0.4.0 is available',
      primary: { action: 'view', label: 'View release' },
      secondary: { action: 'dismiss' },
    });
  });
});
