import { describe, expect, it } from 'vitest';
import { CHECK_INTERVAL_MS, GUARD_INTERVAL_MS, INITIAL_CHECK_DELAY_MS } from '../src/main/updater/service';
import { BUSY, FEED_NEWER, IDLE, LATEST_NEWER, type WorldOptions, flush, updaterWorld } from './helpers/updater-world';

const MAC_FEED = 'https://update.electronjs.org/MobileReality/lantern/darwin-arm64/0.2.2';

describe('the macOS feed', () => {
  it('does nothing when the feed answers 204', async () => {
    const world = updaterWorld({ status: 204 });
    expect(await world.updater.check()).toEqual({ kind: 'up-to-date' });
    expect(world.requests).toEqual([MAC_FEED]);
    expect(world.native.setFeedUrl).not.toHaveBeenCalled();
    expect(world.native.checkForUpdates).not.toHaveBeenCalled();
    expect(world.published).toEqual([]);
  });

  it('schedules the download when the feed answers 200 with a newer release', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER });
    expect(await world.updater.check()).toEqual({ kind: 'downloading', version: '0.3.0' });
    expect(world.native.setFeedUrl).toHaveBeenCalledExactlyOnceWith(MAC_FEED);
    expect(world.native.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('does not start a second download while one is running, nor ask the feed again', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER });
    await world.updater.check();
    expect(await world.updater.check()).toEqual({ kind: 'downloading', version: '0.3.0' });
    expect(world.requests).toHaveLength(1);
    expect(world.native.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('shares one request between checks that overlap', async () => {
    const world = updaterWorld({ status: 204 });
    await Promise.all([world.updater.check(), world.updater.check()]);
    expect(world.requests).toHaveLength(1);
  });

  it('asks again after Squirrel found nothing to download', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER });
    world.updater.start();
    await world.updater.check();
    world.handlers.notAvailable?.();
    await world.updater.check();
    expect(world.requests).toHaveLength(2);
  });

  it('is a quiet no-op, logged once as a warning, when the feed has no download for this build', async () => {
    const world = updaterWorld({ status: 404, body: 'No updates found (needs asset matching .*-(mac|darwin|osx).*.zip in public repository)' });
    expect(await world.updater.check()).toEqual({ kind: 'unavailable' });
    expect(await world.updater.check()).toEqual({ kind: 'unavailable' });
    expect(world.native.setFeedUrl).not.toHaveBeenCalled();
    expect(world.published).toEqual([]);
    expect(world.logs.filter((entry) => entry.severity === 'warning')).toHaveLength(1);
  });

  it('is the same quiet no-op on an architecture without a feed, and asks the service nothing', async () => {
    const world = updaterWorld({ arch: 'x64' });
    expect(await world.updater.check()).toEqual({ kind: 'unavailable' });
    expect(world.requests).toEqual([]);
  });
});

describe('a failing check', () => {
  it('is logged to Diagnostics as a warning and returned as a failure, never shown', async () => {
    const world = updaterWorld({ status: 500 });
    expect(await world.updater.check()).toEqual({ kind: 'failed' });
    expect(world.logs).toEqual([{ severity: 'warning', message: 'Update check failed', detail: expect.stringContaining('500') }]);
    expect(world.published).toEqual([]);
  });

  it('is logged when the network throws', async () => {
    const world = updaterWorld({
      fetch: async () => {
        throw new Error('offline');
      },
    });
    expect(await world.updater.check()).toEqual({ kind: 'failed' });
    expect(world.logs).toEqual([{ severity: 'warning', message: 'Update check failed', detail: expect.stringContaining('offline') }]);
  });

  it('is logged when Squirrel cannot start the download', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER });
    world.native.checkForUpdates.mockImplementation(() => {
      throw new Error('not signed');
    });
    expect(await world.updater.check()).toEqual({ kind: 'failed' });
    expect(world.logs[0]).toMatchObject({ severity: 'warning', detail: expect.stringContaining('not signed') });
    expect(await world.updater.check()).toEqual({ kind: 'failed' });
  });

  it('is logged when the download itself fails, and the next check tries again', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER });
    world.updater.start();
    await world.updater.check();
    world.handlers.error?.('network connection was lost');
    expect(world.logs).toEqual([{ severity: 'warning', message: 'The update could not be downloaded', detail: 'network connection was lost' }]);
    await world.updater.check();
    expect(world.native.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});

describe('the switch and the build', () => {
  it('makes no request at all with automatic checks off', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER });
    world.state.enabled = false;
    world.updater.start();
    for (const timer of world.clock.running()) timer.run();
    expect(await world.updater.check()).toEqual({ kind: 'disabled' });
    await flush();
    expect(world.requests).toEqual([]);
    expect(world.native.checkForUpdates).not.toHaveBeenCalled();
  });

  it('makes no request on the release page path either when switched off', async () => {
    const world = updaterWorld({ platform: 'win32', native: null, status: 200, body: LATEST_NEWER });
    world.state.enabled = false;
    expect(await world.updater.check()).toEqual({ kind: 'disabled' });
    expect(world.requests).toEqual([]);
  });

  it('checks soon after the switch is turned on', async () => {
    const world = updaterWorld({ status: 204 });
    world.state.enabled = false;
    world.updater.start();
    world.state.enabled = true;
    world.updater.settingsChanged();
    await flush();
    expect(world.requests).toEqual([MAC_FEED]);
  });

  it('does nothing in a build that is not packaged: no request, no timer, no native call', async () => {
    const world = updaterWorld({ packaged: false, status: 200, body: FEED_NEWER });
    world.updater.start();
    expect(world.clock.timers).toEqual([]);
    expect(await world.updater.check()).toEqual({ kind: 'not-packaged' });
    expect(world.requests).toEqual([]);
    expect(world.native.checkForUpdates).not.toHaveBeenCalled();
    expect(world.logs).toEqual([]);
  });
});

describe('the schedule', () => {
  it('checks once shortly after start and then every few hours', async () => {
    const world = updaterWorld({ status: 204 });
    world.updater.start();
    expect(world.clock.timers.map(({ ms, repeating }) => ({ ms, repeating }))).toEqual([
      { ms: INITIAL_CHECK_DELAY_MS, repeating: false },
      { ms: CHECK_INTERVAL_MS, repeating: true },
    ]);
    expect(CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    expect(CHECK_INTERVAL_MS).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
    world.clock.timers[0].run();
    await flush();
    expect(world.requests).toHaveLength(1);
  });

  it('stops every timer on stop', () => {
    const world = updaterWorld();
    world.updater.start();
    world.updater.stop();
    expect(world.clock.running()).toEqual([]);
  });
});

describe('the session guard around the install', () => {
  async function downloaded(activity: WorldOptions['activity'] = IDLE) {
    const world = updaterWorld({ status: 200, body: FEED_NEWER, activity });
    world.updater.start();
    await world.updater.check();
    world.handlers.downloaded?.('v0.3.0');
    await flush();
    return world;
  }

  it('installs a downloaded update at once when nothing is alive', async () => {
    const world = await downloaded(IDLE);
    expect(world.native.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('waits and shows "restart when your sessions finish" while something is alive', async () => {
    const world = await downloaded(BUSY);
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
    expect(world.published.at(-1)).toEqual({ kind: 'ready', version: '0.3.0', waiting: true });
  });

  it('never restarts on its own while the guard stays false, however long it waits', async () => {
    const world = await downloaded(BUSY);
    for (let i = 0; i < 5; i++) {
      for (const timer of world.clock.running().filter((t) => t.ms === GUARD_INTERVAL_MS)) timer.run();
      await flush();
    }
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('installs on its own when the guard turns true', async () => {
    const world = await downloaded(BUSY);
    world.state.activity = IDLE;
    for (const timer of world.clock.running().filter((t) => t.ms === GUARD_INTERVAL_MS)) timer.run();
    await flush();
    expect(world.native.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('does not install when the guard turns true after the user said not now', async () => {
    const world = await downloaded(BUSY);
    await world.updater.handle('later');
    expect(world.published.at(-1)).toBeNull();
    world.state.activity = IDLE;
    for (const timer of world.clock.running().filter((t) => t.ms === GUARD_INTERVAL_MS)) timer.run();
    await flush();
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('does not install on its own once automatic updates are switched off', async () => {
    const world = await downloaded(BUSY);
    world.state.enabled = false;
    world.state.activity = IDLE;
    for (const timer of world.clock.running().filter((t) => t.ms === GUARD_INTERVAL_MS)) timer.run();
    await flush();
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('waits when the processes cannot be read', async () => {
    const world = await downloaded({ sessions: [], agentRunning: false, processes: null });
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('waits, and says so once in Diagnostics, when reading the activity throws', async () => {
    const world = await downloaded(async () => {
      throw new Error('ps failed');
    });
    for (const timer of world.clock.running().filter((t) => t.ms === GUARD_INTERVAL_MS)) timer.run();
    await flush();
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
    expect(world.logs.filter((entry) => entry.severity === 'warning')).toHaveLength(1);
  });

  it('asks nothing of the network while it waits', async () => {
    const world = await downloaded(BUSY);
    const before = world.requests.length;
    for (const timer of world.clock.running().filter((t) => t.ms === GUARD_INTERVAL_MS)) timer.run();
    await flush();
    expect(world.requests).toHaveLength(before);
  });
});

describe('Restart now', () => {
  async function waiting() {
    const world = updaterWorld({ status: 200, body: FEED_NEWER, activity: BUSY });
    world.updater.start();
    await world.updater.check();
    world.handlers.downloaded?.('v0.3.0');
    await flush();
    return world;
  }

  it('asks for confirmation naming what would be lost, and installs only after a yes', async () => {
    const world = await waiting();
    expect(await world.updater.restartNow()).toBe(true);
    expect(world.confirmRestart).toHaveBeenCalledExactlyOnceWith({ sessions: 1, agentRunning: false, terminals: 1, running: 0, unknown: false });
    expect(world.native.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('does not install after a no', async () => {
    const world = await waiting();
    world.confirmRestart.mockResolvedValueOnce(false);
    expect(await world.updater.restartNow()).toBe(false);
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('installs without asking when nothing would be lost', async () => {
    const world = await waiting();
    world.state.activity = IDLE;
    expect(await world.updater.restartNow()).toBe(true);
    expect(world.confirmRestart).not.toHaveBeenCalled();
  });

  it('does nothing before an update is downloaded', async () => {
    const world = updaterWorld();
    expect(await world.updater.restartNow()).toBe(false);
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('is the banner button: the restart action goes through the same confirmation', async () => {
    const world = await waiting();
    await world.updater.handle('restart');
    expect(world.confirmRestart).toHaveBeenCalledOnce();
  });

  it('logs and keeps waiting when the install call throws', async () => {
    const world = await waiting();
    world.native.quitAndInstall.mockImplementation(() => {
      throw new Error('ShipIt failed');
    });
    await world.updater.restartNow();
    expect(world.logs.at(-1)).toMatchObject({ severity: 'warning', detail: 'ShipIt failed' });
    expect(world.clock.running().some((timer) => timer.ms === GUARD_INTERVAL_MS)).toBe(true);
  });
});

describe('where Squirrel does not apply', () => {
  const windows = (extra = {}) => updaterWorld({ platform: 'win32', arch: 'x64', native: null, status: 200, body: LATEST_NEWER, ...extra });

  it('compares versions and shows a notice with the newer one', async () => {
    const world = windows();
    expect(await world.updater.check()).toEqual({ kind: 'available', version: '0.4.0', url: 'https://github.com/MobileReality/lantern/releases/tag/v0.4.0' });
    expect(world.requests).toEqual(['https://api.github.com/repos/MobileReality/lantern/releases/latest']);
    expect(world.published).toEqual([{ kind: 'available', version: '0.4.0' }]);
  });

  it('shows no notice when the latest release is not newer', async () => {
    const world = windows({ body: JSON.stringify({ tag_name: 'v0.2.2' }) });
    expect(await world.updater.check()).toEqual({ kind: 'up-to-date' });
    expect(world.published).toEqual([]);
  });

  it('opens the release page from the notice button, only on the fixed repository', async () => {
    const world = windows();
    await world.updater.check();
    await world.updater.handle('view');
    expect(world.openRelease).toHaveBeenCalledExactlyOnceWith('https://github.com/MobileReality/lantern/releases/tag/v0.4.0');
  });

  it('hides the notice for that version once dismissed, and shows a newer one again', async () => {
    const world = windows();
    await world.updater.check();
    await world.updater.handle('dismiss');
    expect(world.published.at(-1)).toBeNull();
    world.state.body = JSON.stringify({ tag_name: 'v0.5.0' });
    await world.updater.check();
    expect(world.published.at(-1)).toEqual({ kind: 'available', version: '0.5.0' });
  });

  it('logs a failed check as a warning without a notice', async () => {
    const world = windows({ status: 403 });
    expect(await world.updater.check()).toEqual({ kind: 'failed' });
    expect(world.logs).toEqual([{ severity: 'warning', message: 'Update check failed', detail: expect.stringContaining('403') }]);
    expect(world.published).toEqual([]);
  });

  it('never installs or downloads anything', async () => {
    const world = windows();
    world.updater.start();
    await world.updater.check();
    await world.updater.handle('restart');
    expect(world.native.setFeedUrl).not.toHaveBeenCalled();
    expect(world.native.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe('the notice a new window asks for', () => {
  it('is the current notice, or none', async () => {
    const world = updaterWorld({ status: 200, body: FEED_NEWER, activity: BUSY });
    expect(world.updater.notice()).toBeNull();
    world.updater.start();
    await world.updater.check();
    world.handlers.downloaded?.('0.3.0');
    await flush();
    expect(world.updater.notice()).toEqual({ kind: 'ready', version: '0.3.0', waiting: true });
  });
});
