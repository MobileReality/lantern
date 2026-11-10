import type { UpdateAction, UpdateNotice } from '../../shared/updates';
import { type ActivityState, type LiveParts, canInstallNow, liveParts } from './guard';
import { type HttpFetch, isReleasePageUrl, macFeedUrl, readLatestRelease, readMacFeed } from './feed';
import type { NativeUpdater } from './native';
import { displayVersion } from './version';

export const INITIAL_CHECK_DELAY_MS = 20_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const GUARD_INTERVAL_MS = 30_000;

export type CheckOutcome =
  | { kind: 'disabled' }
  | { kind: 'not-packaged' }
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

export interface UpdateTimers {
  after(ms: number, run: () => void): () => void;
  every(ms: number, run: () => void): () => void;
}

export interface UpdaterDeps {
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  enabled: () => boolean;
  fetch: HttpFetch;
  native: NativeUpdater | null;
  activity: () => Promise<ActivityState>;
  log: (severity: 'info' | 'warning', message: string, detail?: string) => void;
  publish: (notice: UpdateNotice | null) => void;
  confirmRestart: (live: LiveParts) => Promise<boolean>;
  openRelease: (url: string) => void;
  timers: UpdateTimers;
}

const UNKNOWN_ACTIVITY: ActivityState = { sessions: [], agentRunning: false, processes: null };

export function createUpdater(deps: UpdaterDeps) {
  const native = deps.platform === 'darwin' ? deps.native : null;
  let checking: Promise<CheckOutcome> | null = null;
  let downloading: string | null = null;
  let downloaded: string | null = null;
  let release: { version: string; url: string } | null = null;
  let dismissedRelease: string | null = null;
  let postponed = false;
  let installing = false;
  let settling = false;
  let loggedUnavailable = false;
  let loggedActivity = false;
  let wasEnabled = false;
  let lastNotice = 'null';
  let stopGuard: (() => void) | null = null;
  const stops: (() => void)[] = [];

  const warn = (message: string, detail?: string) => deps.log('warning', message, detail);

  function currentNotice(): UpdateNotice | null {
    if (downloaded !== null) return postponed ? null : { kind: 'ready', version: downloaded, waiting: deps.enabled() };
    if (release !== null && dismissedRelease !== release.version) return { kind: 'available', version: release.version };
    return null;
  }

  function publish() {
    const notice = currentNotice();
    const serialized = JSON.stringify(notice);
    if (serialized === lastNotice) return;
    lastNotice = serialized;
    deps.publish(notice);
  }

  async function readActivity(): Promise<ActivityState> {
    try {
      return await deps.activity();
    } catch (error) {
      if (!loggedActivity) warn('Could not tell whether sessions are running, so the update waits', error instanceof Error ? error.message : String(error));
      loggedActivity = true;
      return UNKNOWN_ACTIVITY;
    }
  }

  function install(version: string) {
    if (!native || installing) return;
    installing = true;
    stopGuard?.();
    stopGuard = null;
    deps.log('info', `Restarting to install Lantern ${version}`);
    try {
      native.quitAndInstall();
    } catch (error) {
      installing = false;
      warn('The update could not be installed', error instanceof Error ? error.message : String(error));
      startGuard();
    }
  }

  async function settle() {
    if (downloaded === null || installing || settling) return;
    settling = true;
    try {
      const idle = canInstallNow(await readActivity());
      if (downloaded !== null && idle && !postponed && deps.enabled()) install(downloaded);
      else publish();
    } finally {
      settling = false;
    }
  }

  function startGuard() {
    if (stopGuard || downloaded === null) return;
    stopGuard = deps.timers.every(GUARD_INTERVAL_MS, () => void settle());
  }

  function logUnavailableOnce(reason: string) {
    if (loggedUnavailable) return;
    loggedUnavailable = true;
    warn('Lantern cannot update itself yet, so it only checks by hand', reason);
  }

  async function checkSquirrel(squirrel: NativeUpdater): Promise<CheckOutcome> {
    if (downloaded !== null) return { kind: 'ready', version: downloaded };
    const url = macFeedUrl(deps.version, deps.arch);
    if (!url) {
      logUnavailableOnce(`no update feed is published for ${deps.arch}`);
      return { kind: 'unavailable' };
    }
    if (downloading !== null) return { kind: 'downloading', version: downloading };
    const answer = await readMacFeed(deps.fetch, url, deps.version);
    if (answer.kind === 'up-to-date') return answer;
    if (answer.kind === 'unavailable') {
      logUnavailableOnce(answer.reason);
      return { kind: 'unavailable' };
    }
    if (answer.kind === 'failed') {
      warn('Update check failed', answer.reason);
      return { kind: 'failed' };
    }
    squirrel.setFeedUrl(url);
    squirrel.checkForUpdates();
    downloading = answer.version;
    return { kind: 'downloading', version: answer.version };
  }

  async function checkRelease(): Promise<CheckOutcome> {
    const answer = await readLatestRelease(deps.fetch, deps.version);
    if (answer.kind === 'up-to-date') return answer;
    if (answer.kind === 'failed') {
      warn('Update check failed', answer.reason);
      return { kind: 'failed' };
    }
    release = { version: answer.version, url: answer.url };
    publish();
    return { kind: 'available', version: answer.version, url: answer.url };
  }

  async function performCheck(): Promise<CheckOutcome> {
    try {
      return native ? await checkSquirrel(native) : await checkRelease();
    } catch (error) {
      warn('Update check failed', error instanceof Error ? error.message : String(error));
      downloading = null;
      return { kind: 'failed' };
    }
  }

  function check(): Promise<CheckOutcome> {
    if (!deps.packaged) return Promise.resolve({ kind: 'not-packaged' });
    if (!deps.enabled()) return Promise.resolve({ kind: 'disabled' });
    checking ??= performCheck().finally(() => {
      checking = null;
    });
    return checking;
  }

  function onDownloaded(name: string) {
    downloaded = displayVersion(name) || downloading || deps.version;
    downloading = null;
    postponed = false;
    deps.log('info', `Lantern ${downloaded} is downloaded and waits for a quiet moment to install`);
    startGuard();
    void settle();
  }

  async function restartNow(): Promise<boolean> {
    if (downloaded === null || installing) return false;
    const activity = await readActivity();
    if (!canInstallNow(activity) && !(await deps.confirmRestart(liveParts(activity)))) return false;
    install(downloaded);
    return true;
  }

  async function handle(action: UpdateAction): Promise<void> {
    if (action === 'restart') {
      await restartNow();
      return;
    }
    if (action === 'view' && release && isReleasePageUrl(release.url)) deps.openRelease(release.url);
    if (action === 'later' || (action === 'dismiss' && downloaded !== null)) postponed = true;
    else if (release) dismissedRelease = release.version;
    publish();
  }

  function settingsChanged() {
    const on = deps.enabled();
    const turnedOn = on && !wasEnabled;
    wasEnabled = on;
    if (turnedOn) void check();
    publish();
  }

  function start() {
    if (!deps.packaged || stops.length > 0) return;
    wasEnabled = deps.enabled();
    if (native) {
      native.onDownloaded(onDownloaded);
      native.onNotAvailable(() => {
        downloading = null;
      });
      native.onError((message) => {
        downloading = null;
        warn('The update could not be downloaded', message);
      });
    }
    stops.push(deps.timers.after(INITIAL_CHECK_DELAY_MS, () => void check()), deps.timers.every(CHECK_INTERVAL_MS, () => void check()));
  }

  function stop() {
    for (const cancel of stops.splice(0)) cancel();
    stopGuard?.();
    stopGuard = null;
  }

  return { start, stop, check, restartNow, handle, settingsChanged, notice: currentNotice };
}

export type Updater = ReturnType<typeof createUpdater>;
