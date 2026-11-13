import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import * as electron from 'electron';
import { start as startServer } from './server';
import * as hooks from './hooks';
import * as state from './state';
import * as scanner from './scanner';
import { createPoller } from './claude-poll';
import { runCleanups } from './hook-cleanup';
import { scanCodex } from './codex-scanner';
import * as serveweb from './serveweb';
import { createEditorDemand } from './editor-demand';
import { SERVER_LICENSE_URL, createServerLicenseConsent } from './serveweb-license';
import { isPermissionGranted, withMicrophonePolicy } from './webview-permissions';
import * as projects from './projects';
import * as skills from './skills';
import { registerExtensionsIpc } from './extensions-ipc';
import { readProjectFile } from './filecontent';
import { projectIdent } from './project-ident';
import { readRegisteredPrFileDiff, readRegisteredPrFileStats } from './lantern-prdiff';
import { readRegisteredPrFile } from './lantern-prfile';
import { loadRegisteredPrOverlay } from './lantern-proverlay';
import { enterPr, refreshPrData, warmPrs } from './lantern-pr-warm';
import { readRegisteredMacro } from './lantern-macro-load';
import * as lantern from './lantern';
import { lanternStamp } from './lantern-stamp';
import { compareCommits, compareRefs, compareStat, hasWorktree, withLocalPrs, worktreeStamp } from './lantern-local';
import { readProgress } from './setup-progress';
import { readSetupState, settleSetup } from './setup-state';
import * as explains from './explains';
import { onMigrationProblem } from './metadir';
import * as agent from './agent';
import { installOnOpen, reinstallOf, setPermissionConsent, settledFor, syncPermissionsOf } from './bundle';
import { createPermissionConsent } from './permission-consent';
import { enableMicrophone } from './mic-consent';
import { msg } from '../shared/lang/messages';
import * as popout from './popout';
import { init as initWindows, projectWins, isOpen, focusWin, newWorkspaceWindow, hideDockIfIdle, focusProjectWindow, openFromArgv, windowOpenHandler, ownsProject, projectKey } from './windows';
import * as cli from './cli';
import { installUserCli, uninstallUserCli, userCliStatus } from './cli-user-install';
import { cliPort } from './cli-user-port';
import { createLastWindowHandler } from './last-window';
import * as settings from './settings';
import * as settingsStore from './settings-store';
import { resolveLanguage } from './languages';
import { isProvider } from './provider';
import { registeredProject, safeAgentRequest } from './agent-request';
import { rtkStatus } from './rtk-status';
import type { Provider } from './provider';
import * as devserver from './devserver';
import { appMenuTemplate } from './app-menu';
import { createCommandKeys } from './commands';
import { platformName } from '../shared/platform';
import * as notifier from './notifier';
import * as codexHooks from './codex-hooks';
import * as overlay from './overlay';
import * as trayPopover from './tray-popover';
import { compactTrayMenu, fullTrayMenu, type TrayMenuDeps } from './tray-menu';
import { buildTrayModel } from '@shared/tray-model';
import type { TrayAction } from '@shared/tray-action';
import { overlayCard } from './notifycard';
import { SemanticService } from './lsp/semantic-service';
import type { SemanticHighlightRequest } from '../shared/code-highlighting';
import type { CommandId } from '../shared/commands';
import { affectsSetting, type SettingsChange, type SettingsUpdateResult } from '../shared/settings-registry';
import { lspRuntimePath } from './lsp/runtime-path';
import { windowIconPath } from './window-icon';
import { readTranscript, transcriptPath } from './session-context';
import { SOUND_SETTING_FOR_KIND } from '../shared/settings-notifications';
import { CARD_KINDS, type CardKind, deliverTransitionCard, sampleCard, sampleLabel } from './session-notification';
import { DEV_PROFILE, NOTIFICATIONS_OFF, PORT } from '../shared/config';
import { APP_NAME, userDataDir } from '@shared/app-identity';
import { MEMORY_FREE_CHANNEL, MEMORY_WATCH_CHANNEL } from '../shared/memory';
import { PR_EXPLAIN_CANCEL, PR_EXPLAIN_DONE, PR_EXPLAIN_SAVED, PR_EXPLAIN_START } from '../shared/pr-explain';
import type { PrExplainDone } from '../shared/pr-explain';
import { createPrExplainService } from './pr-explain';
import { createLocalReasonsService } from './local-reasons';
import { canJumpToSession, jumpToSession } from './session-jump';
import { createMemoryService } from './memory-service';
import { createProjectRelease } from './memory-free';
import { createAuth } from './auth';
import { electronCipher } from './auth/electron-cipher';
import { namesInProjectFiles } from './auth/env-names';
import { registerAuthIpc } from './auth/ipc';
import { createCredentialServer } from './auth/credential-server';
import { credentialSocketPath } from './auth/credential-socket';
import { knownProject } from './auth/known-project';
import { accountLookup } from './lantern-host-account';
import { codeHostOf } from './lantern-host-origin';
import { hostStatus } from './lantern-host-status';
import { readBranch, resolveRoot } from './projectroot';
import { devInstance, hslToRgb, recordDebugHandle, recordInstance, seedUserData, shortName, tintBitmap } from './dev-instance';
import { currentDiagnostics, reportDiagnostic, startDiagnostics } from './diagnostics';
import { guardIpc } from './diagnostics/ipc-guard';
import { registerDiagnosticsIpc } from './diagnostics/ipc';
import { createUpdater } from './updater/service';
import { createUpdateController, registerUpdateIpc } from './updater/controller';
import { squirrelUpdater, type AutoUpdaterLike } from './updater/native';
import { readProcessActivity } from './updater/process-activity';
import { restartDialog } from './updater/dialogs';
import { runCommand } from './memory-collect';
import { MEMORY_SUPPORTED_PLATFORMS } from './memory-service';
import { UPDATE_NOTICE_CHANNEL } from '../shared/updates';

// Fuses disable run-as-node in the packaged app, but `npm start` (dev) still uses
// the system electron, which this machine can boot as plain Node — guard for that.
if (!electron.app) {
  console.error('Electron is running in Node mode. Launch the packaged app, or: env -u ELECTRON_RUN_AS_NODE electron .');
  process.exit(1);
}

const { app, Tray, Menu, BrowserWindow, Notification, nativeImage, shell, ipcMain, session, dialog, clipboard } = electron;

// Installed before any handler is registered so every IPC handler's failure is recorded.
guardIpc(ipcMain, reportDiagnostic);

// Force English so the embedded editor (serve-web) uses VS Code's built-in NLS
// bundle — non-English language packs render broken "{0}" placeholders in the
// web/server build.
app.commandLine.appendSwitch('lang', 'en-US');

// Pinned so the data folder never follows the package name: existing users keep their settings.
app.setName(APP_NAME);
app.setPath('userData', userDataDir(app.getPath('appData')));

const INSTANCE = DEV_PROFILE ? devInstance(app.getAppPath(), process.env, (dir) => readBranch(dir) || null) : null;
if (INSTANCE) {
  const shared = `${app.getPath('userData')}-dev`;
  const own = `${shared}-${INSTANCE.key}`;
  seedUserData(own, shared);
  app.setPath('userData', own);
}

const POPOVER_TRAY = process.platform === 'darwin';
const PARTITION = 'persist:ccm';
const SCAN_INTERVAL_MS = 4000;

let tray: InstanceType<typeof Tray> | null = null;
let wsWin: InstanceType<typeof BrowserWindow> | null = null;
let server: import('node:http').Server | null = null;
let pendingOpenCwd: string | null = null;
let pendingCommands: CommandId[] = [];
let wsLoaded = false;
const cliScript = cli.scriptPath(app.isPackaged, process.resourcesPath, __dirname, process.platform);
const cliContext = () => ({ platform: process.platform, home: os.homedir(), env: process.env, script: cliScript, port: cliPort });
const semanticService = new SemanticService(lspRuntimePath(app.isPackaged, process.resourcesPath, __dirname));

app.setAppUserModelId('com.mobilereality.lantern'); // required for Windows toast notifications

const windowIcon = windowIconPath(process.platform, app.isPackaged, process.resourcesPath, __dirname);
const dockIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'appicon.png'));
if (process.platform === 'darwin' && app.dock) {
  if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  app.dock.hide();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // The CLI launches with `open -n` because plain `open --args` drops the args when
  // the app is already running; the extra instance loses the lock and lands here.
  const ready = app.whenReady().then(init);
  app.on('second-instance', (_e, argv, workingDirectory) => {
    ready.then(() => openFromArgv(argv, workingDirectory, openWorkspace)).catch((err) => console.error('Could not open the requested window:', err));
  });
}

// The app was previously packaged as "Claude Code Monitor", which keyed a different
// userData folder. On first run under the new name, copy the old settings, project
// list across so the rename doesn't wipe them.
const LEGACY_FILES = ['ccm-projects.json', 'ccm-settings.json', 'ccm-skills.json'];

function migrateUserData() {
  try {
    const dir = app.getPath('userData');
    if (fs.existsSync(path.join(dir, 'ccm-projects.json'))) return;
    const legacy = path.join(path.dirname(dir), 'Claude Code Monitor');
    if (!fs.existsSync(legacy)) return;
    // Only our own files — not Electron's runtime cruft (Cache, SingletonLock, …),
    // which can be locked and would abort the copy.
    for (const name of LEGACY_FILES) {
      const src = path.join(legacy, name);
      const dst = path.join(dir, name);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
    }
  } catch {}
}

async function init() {
  migrateUserData();
  startDiagnosticsLog();
  initWindows({
    preload: path.join(__dirname, 'preload', 'workspace.js'),
    htmlDir: path.join(__dirname, 'renderer'),
    dockIcon,
    windowIcon,
    trust: (wc) => trusted.add(wc),
    untrust: (wc) => trusted.delete(wc),
    mainWindow: () => wsWin,
    // The hidden notification card window keeps window-all-closed from firing, so the last user window closing triggers it too.
    onIdle: quitWithoutReachableTray,
  });
  let codexToken = '';
  try {
    codexToken = codexHooks.ensureToken(codexHookPaths());
  } catch (err) {
    console.error('Codex hook token setup failed:', (err as Error).message);
  }
  removeLegacyHooks();
  overlay.init({
    onOpen: (card) => (card && typeof card.cwd === 'string' && card.cwd ? openProjectInWorkspace(card.cwd) : openWorkspace()),
    onJump: (card) => {
      if (typeof card.sessionId !== 'string' || !card.sessionId) return;
      jumpToSession(card.sessionId)
        .then((ok) => ok || (typeof card.cwd === 'string' && card.cwd ? openProjectInWorkspace(card.cwd) : openWorkspace()))
        .catch((err) => console.error('Could not jump to the session:', err));
    },
    prefs: (kind) => ({
      animations: settingsStore.get('notifications.animations'),
      dismissMs: settingsStore.get('notifications.dismissSeconds') * 1000,
      volume: settingsStore.get('notifications.volume') / 100,
      timbre: settingsStore.get(SOUND_SETTING_FOR_KIND[kind]),
    }),
    followCursor: () => settingsStore.get('notifications.followCursor'),
    animations: () => settingsStore.get('notifications.animations'),
    position: () => settingsStore.get('notifications.position'),
  });
  trayPopover.init({ model: trayModel, onOpenProject: openProjectInWorkspace, onAction: runTrayAction });

  try {
    server = await startServer({ onChange, codexToken });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    notify({ title: 'Lantern could not start', body: e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : String(e.message || e) });
    app.quit();
    return;
  }
  if (INSTANCE) announceDevInstance(INSTANCE, (server.address() as import('node:net').AddressInfo).port);

  projects.load();
  skills.loadConfig();
  settings.load();
  settingsStore.load();
  settingsStore.watch();
  updater.start();
  onMigrationProblem(({ projectPath, message }) => alertUser(`Lantern could not move ${path.basename(projectPath)}'s local data`, message));
  refreshMenu();
  setupWebviewPermissions();
  hardenWebContents();
  if (process.env.CCM_DEBUG) {
    const harness = devserver.start(() => wsWin, openWorkspace, (kind) => {
      if (!CARD_KINDS.includes(kind as CardKind)) return false;
      overlay.show(sampleCard(kind as CardKind));
      return true;
    }, () => trayPopover.toggle(tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }));
    harness.server.once('listening', () => {
      const debugPort = (harness.server.address() as import('node:net').AddressInfo).port;
      const handle = { debugPort, debugToken: harness.token };
      const file = INSTANCE ? recordInstance(app.getAppPath(), handle) : recordDebugHandle(app.getPath('userData'), handle);
      console.log(`CCM_DEBUG harness on http://127.0.0.1:${debugPort} · token in ${file}`);
    });
  }
  popout.init({
    windowIcon,
    preload: path.join(__dirname, 'preload', 'workspace.js'),
    htmlDir: path.join(__dirname, 'renderer'),
    onCreated: (wc) => trusted.add(wc),
    onClosed: (wc) => {
      trusted.delete(wc);
      hideDockIfIdle();
    },
  });
  void credentialServer.start();

  // macOS uses a monochrome template (auto-recolored per appearance); Windows/Linux
  // need a colored icon or the tray glyph renders black/invisible.
  const trayAsset = process.platform === 'darwin' ? 'trayTemplate.png' : 'trayColor.png';
  const baseIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', trayAsset));
  const trayIcon = INSTANCE && !baseIcon.isEmpty() ? tintedIcon(baseIcon, INSTANCE.hue) : baseIcon;
  if (process.platform === 'darwin' && !INSTANCE) trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip(INSTANCE ? `Lantern (dev: ${INSTANCE.name})` : 'Lantern');
  if (INSTANCE && process.platform === 'darwin') tray.setTitle(shortName(INSTANCE.name));
  if (POPOVER_TRAY) {
    tray.on('click', () => trayPopover.toggle(tray!.getBounds()));
    tray.on('right-click', () => tray!.popUpContextMenu(Menu.buildFromTemplate(compactTrayMenu(trayMenuDeps()))));
  } else {
    tray.on('click', () => tray!.popUpContextMenu());
  }
  refreshTray();

  openFromArgv(process.argv, process.cwd());

  runScan();
  setInterval(runScan, SCAN_INTERVAL_MS);
  claudePoller.start();
}

function startDiagnosticsLog() {
  const service = startDiagnostics({
    file: path.join(app.getPath('userData'), 'diagnostics', 'events.jsonl'),
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    packaged: app.isPackaged,
    home: os.homedir(),
    projects: projectPaths,
    proc: process,
    app,
  });
  registerDiagnosticsIpc({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    fromWorkspace,
    service,
    writeClipboard: (text) => clipboard.writeText(text),
    openExternal: (url) => shell.openExternal(url),
  });
}

function announceDevInstance(instance: NonNullable<typeof INSTANCE>, httpPort: number) {
  const userData = app.getPath('userData');
  process.env.LANTERN_CREDENTIAL_SOCKET = credentialSocketPath({ userData, platform: process.platform, username: os.userInfo().username, dev: true });
  const cdpPort = app.commandLine.hasSwitch('remote-debugging-port') ? devToolsPort(userData) : null;
  recordInstance(app.getAppPath(), { name: instance.name, branch: instance.branch, worktree: instance.worktree, userData, httpPort, cdpPort });
  console.log(`Lantern dev build "${instance.name}" · data ${userData} · http ${httpPort}${cdpPort ? ` · cdp ${cdpPort}` : ''}`);
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(shortName(instance.name));
}

const TRAY_SATURATION = 0.75;
const TRAY_LIGHTNESS = 0.55;

function tintedIcon(icon: Electron.NativeImage, hue: number) {
  const rgb = hslToRgb(hue, TRAY_SATURATION, TRAY_LIGHTNESS);
  const { width, height } = icon.getSize();
  const tinted = nativeImage.createEmpty();
  for (const scaleFactor of icon.getScaleFactors()) {
    const size = { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor), scaleFactor };
    const bitmap = nativeImage.createFromBitmap(tintBitmap(icon.toBitmap({ scaleFactor }), rgb), size);
    tinted.addRepresentation({ scaleFactor, buffer: bitmap.toPNG() });
  }
  return tinted;
}

function devToolsPort(userData: string) {
  try {
    return Number(fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf8').split('\n')[0]) || null;
  } catch {
    return null;
  }
}

const serverLicense = createServerLicenseConsent({
  stored: settings.serverLicenseAccepted,
  remember: settings.acceptServerLicense,
  ask: async () => {
    const READ = 2;
    for (;;) {
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        message: msg('serverLicense.message'),
        detail: msg('serverLicense.detail', { url: SERVER_LICENSE_URL }),
        buttons: [msg('serverLicense.accept'), msg('serverLicense.decline'), msg('serverLicense.read')],
        defaultId: 1,
        cancelId: 1,
      };
      const focused = BrowserWindow.getFocusedWindow();
      const { response } = await (focused ? dialog.showMessageBox(focused, options) : dialog.showMessageBox(options));
      if (response !== READ) return response === 0;
      await shell.openExternal(SERVER_LICENSE_URL);
    }
  },
});

function launchEditor(askLicense: boolean) {
  if (!serveweb.isAvailable()) return;
  serveweb.start(pushState, pushState, { reclaimIdleHosts: settingsStore.get('tabs.closeIdleProjectTabs'), license: serverLicense, askLicense });
}

const editorDemand = createEditorDemand(launchEditor);

async function confirmMicPatch(sender: Electron.WebContents) {
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    message: msg('micPatch.message'),
    detail: msg('micPatch.detail'),
    buttons: [msg('micPatch.enable'), msg('micPatch.cancel')],
    defaultId: 1,
    cancelId: 1,
  };
  const win = BrowserWindow.fromWebContents(sender);
  const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  return response === 0;
}

function removeLegacyHooks() {
  runCleanups([['event hooks', hooks.uninstall], ['notifier hooks', notifier.uninstall]], (message) => console.error(message));
}

const notificationsOn = () => !NOTIFICATIONS_OFF && settingsStore.get('notifications.enabled');

const claudePoller = createPoller({
  scan: () => scanner.scan(),
  apply: (snapshot) => {
    if (snapshot === null) {
      state.unavailable();
      return;
    }
    for (const notice of state.reconcile(snapshot)) {
      deliverTransitionCard(notice, notificationsOn(), overlay.show, projects.rootForCwd, (s) => (s.sessionId ? readTranscript(transcriptPath(s.cwd, s.sessionId)) : []), canJumpToSession);
    }
  },
  publish: () => {
    refreshTray();
    pushState();
  },
  hasOpenWindow: () => !!wsWin && !wsWin.isDestroyed(),
  cheap: () => scanner.scannedFromFiles(),
});

function runScan() {
  try {
    const codexSessions = scanCodex().filter((s) => s.cwd && settings.provider(projects.rootForCwd(s.cwd)) === 'codex');
    state.mergeDiscovered(codexSessions);
    state.pruneStale();
    if ((isOpen(wsWin) || projectWins.size) && !serveweb.status().ready) editorDemand.keepWarm();
    refreshTray();
    pushState();
  } catch {
    // best-effort
  }
}

function onChange({ session: s, notify: payload }: { session?: any; notify?: any }) {
  if (payload && s?.provider === 'codex') {
    const root = projects.rootForCwd(s.cwd);
    const project = path.basename(root) || s.project || 'project';
    const title = `Codex — ${project}`;
    notify({ title, body: payload.body }, s);
    if (notificationsOn()) {
      const card = overlayCard({ id: payload.id, kind: payload.kind, title, context: payload.body, cwd: s.cwd }, projects.rootForCwd);
      if (card) overlay.show({ id: String(card.id), kind: card.kind === 'permission' ? 'permission' : 'done', title, context: String(card.context ?? ''), cwd: s.cwd, sessionId: '', repoName: String(card.repoName ?? project), branch: root ? readBranch(root) : '' });
    }
  }
  refreshTray();
  pushState();
}

function pushState() {
  const groups = projects.groups();
  const info = serveweb.status();
  for (const win of [wsWin, ...projectWins.values()]) {
    if (!isOpen(win)) continue;
    win.webContents.send('ws:projects', groups);
    win.webContents.send('ws:info', info);
  }
}

function refreshMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform, app.name, runCommandInWorkspace, commandKeys.keymap().byCommand, () => void checkForUpdates())));
}

function refreshTray() {
  if (!tray) return;
  if (POPOVER_TRAY) trayPopover.update();
  else tray.setContextMenu(Menu.buildFromTemplate(fullTrayMenu(trayMenuDeps())));
}

function trayTests() {
  return notificationsOn() ? CARD_KINDS.map((kind) => ({ kind, label: sampleLabel(kind) })) : [];
}

function trayModel() {
  return buildTrayModel(projects.groups(), { home: os.homedir(), tests: trayTests(), isClearable: state.isClearable });
}

function clearFinished() {
  state.clearFinished();
  onChange({});
}

function trayMenuDeps(): TrayMenuDeps {
  return {
    projects: projects.groups().map((g) => ({ name: g.name, path: g.path, emoji: state.STATES[projects.aggregateState(g) as keyof typeof state.STATES].emoji })),
    tests: trayTests(),
    openProject: openProjectInWorkspace,
    openWorkspace,
    clearFinished,
    testNotification: (kind) => overlay.show(sampleCard(kind as CardKind)),
    quit: () => app.quit(),
  };
}

function runTrayAction(action: TrayAction) {
  if (action.type === 'workspace') openWorkspace();
  else if (action.type === 'clear') clearFinished();
  else if (action.type === 'test') overlay.show(sampleCard(action.kind as CardKind));
  else app.quit();
}

function openWorkspace() {
  claudePoller.wake();
  if (focusWin(wsWin)) return;
  wsWin = newWorkspaceWindow('Lantern');
  wsLoaded = false;
  wsWin.loadFile(path.join(__dirname, 'renderer', 'workspace.html'));
  wsWin.on('closed', () => {
    wsWin = null;
    wsLoaded = false;
    pendingOpenCwd = null;
    pendingCommands = [];
    hideDockIfIdle();
  });
  wsWin.webContents.on('did-finish-load', () => {
    wsLoaded = true;
    if (pendingOpenCwd) {
      wsWin!.webContents.send('ws:open', pendingOpenCwd, path.basename(pendingOpenCwd));
      pendingOpenCwd = null;
    }
    for (const id of pendingCommands) wsWin!.webContents.send('command:run', id);
    pendingCommands = [];
  });
}

function runCommandInWorkspace(id: CommandId) {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && [...projectWins.values()].includes(focused)) {
    const wc = focused.webContents;
    if (wc.isLoading()) wc.once('did-finish-load', () => wc.send('command:run', id));
    else wc.send('command:run', id);
    return;
  }
  openWorkspace();
  if (wsLoaded && wsWin && !wsWin.isDestroyed()) wsWin.webContents.send('command:run', id);
  else pendingCommands.push(id);
}

// A window that exists but hasn't loaded would drop ws:open, so hold the target
// until did-finish-load instead of sending into the void.
function openProjectInWorkspace(cwd: string) {
  const root = projects.rootForCwd(cwd);
  if (focusProjectWindow(cwd, root)) return;
  openWorkspace();
  if (!root) return;
  installOnOpen(root, { provider: settings.provider(root) });
  if (wsLoaded && wsWin && !wsWin.isDestroyed()) wsWin.webContents.send('ws:open', root, path.basename(root));
  else pendingOpenCwd = root;
}

// A problem the user has to know about is shown even when session notifications are switched off.
function alertUser(title: string, body: string) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, silent: true }).show();
  } catch {}
}

function notify({ title, body }: { title: string; body: string }, s?: any) {
  if (!notificationsOn()) return;
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => (s && s.cwd ? openProjectInWorkspace(s.cwd) : openWorkspace()));
    n.show();
  } catch {
    try {
      execFile('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`]);
    } catch {}
  }
}

// Without granting these, Electron silently blocks the embedded editor's mic and
// Claude's voice button disappears. Only the loopback serve-web origin gets them: the
// partition also loads whatever a link or redirect lands on, and that must stay refused.
function setupWebviewPermissions() {
  const ses = session.fromPartition(PARTITION);
  const servePort = () => serveweb.status().port;
  ses.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(isPermissionGranted(permission, servePort(), wc.getURL(), details.requestingUrl)),
  );
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) =>
    isPermissionGranted(permission, servePort(), wc?.getURL(), requestingOrigin, details.requestingUrl),
  );
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: withMicrophonePolicy(details.responseHeaders || {}, details.url, servePort()) });
  });
}

// The editor webview allows popups only so this handler sees them: http(s) links go to the browser, nothing opens as a window.
function hardenWebContents() {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(windowOpenHandler((url) => shell.openExternal(url)));
    commandKeys.attach(contents);
  });
}

// Reject IPC that didn't come from one of our own windows (the main workspace or a
// detached pop-out tool window).
const trusted = new Set<Electron.WebContents>();
const commandKeys = createCommandKeys<Electron.WebContents>({
  platform: platformName(process.platform),
  bindings: () => settingsStore.get('keymap.bindings'),
  isTrusted: (wc) => trusted.has(wc) && !popout.isPopout(wc),
});
const fromWorkspace = (fn: (e: any, ...args: any[]) => any) => (e: any, ...args: any[]) => (trusted.has(e.sender) ? fn(e, ...args) : undefined);

function showOpenDialogFor(sender: Electron.WebContents, options: Electron.OpenDialogOptions) {
  const win = BrowserWindow.fromWebContents(sender);
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

setPermissionConsent(
  createPermissionConsent({
    stored: settings.permissionConsent,
    remember: settings.setPermissionConsent,
    ask: async (project) => {
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        message: msg('permissionConsent.message', { project: path.basename(project) }),
        detail: msg('permissionConsent.detail'),
        buttons: [msg('permissionConsent.allow'), msg('permissionConsent.decline')],
        defaultId: 1,
        cancelId: 1,
      };
      const focused = BrowserWindow.getFocusedWindow();
      const { response } = await (focused ? dialog.showMessageBox(focused, options) : dialog.showMessageBox(options));
      return response === 0;
    },
  }),
);

function pushAgentStatus() {
  const status = { running: agent.isRunning() };
  for (const contents of trusted) if (!contents.isDestroyed()) contents.send('agent:status-changed', status);
}

function pushProvider(project: string, provider: Provider) {
  for (const contents of trusted) if (!contents.isDestroyed()) contents.send('settings:provider-changed', { project, provider });
}

function codexHookPaths() {
  return codexHooks.paths(app.getPath('userData'), path.join(__dirname, 'notify-hooks'));
}

function codexHookResult(action: () => unknown) {
  try {
    return { ok: true, ...(action() as object) };
  } catch (err) {
    return { ok: false, configured: false, error: (err as Error).message };
  }
}

const projectPaths = () => projects.groups().map((group) => group.path);
const memoryService = createMemoryService({ platform: process.platform, rootPid: process.pid, projectPaths });
function mapLanguage(project: string) {
  return resolveLanguage(project, 'language.map', { user: settingsStore.get('language.map'), fallback: (p) => settings.requestedLanguage(p) });
}

function explainLanguage(project: string) {
  return resolveLanguage(project, 'language.explainers', { user: settingsStore.get('language.explainers'), fallback: mapLanguage }) ?? 'english';
}

const oneShotDeps = {
  userData: app.getPath('userData'),
  language: explainLanguage,
  run: { prepareLaunch: agent.prepareClaudeLaunch, scratchDir: path.join(app.getPath('userData'), 'pr-explain-run') },
  log: (line: string) => console.log(line),
};
const prExplain = createPrExplainService({ projectPaths, ...oneShotDeps });
const localReasons = createLocalReasonsService({ ...oneShotDeps, limits: () => ({ replyChars: settingsStore.get('reasons.maxReplyCharacters'), diffChars: settingsStore.get('reasons.maxDiffCharacters') }) });

const releaseProjectMemory = createProjectRelease({
  platform: process.platform,
  rootPid: process.pid,
  serverPid: serveweb.serverPid,
  projectPaths,
  sharedWindow: (project) => isOpen(projectWins.get(projectKey(project))),
});

const auth = createAuth({
  dir: app.getPath('userData'),
  cipher: electronCipher(electron.safeStorage),
  drivers: {},
  resolveProject: (project) => resolveRoot(project, projectPaths()),
  detectHost: (root) => codeHostOf(root),
  readFileNames: namesInProjectFiles,
  log: (line) => console.log(line),
});
hostStatus.useAccounts(accountLookup(auth));
const credentialServer = createCredentialServer({
  socketPath: credentialSocketPath({ userData: app.getPath('userData'), platform: process.platform, username: os.userInfo().username, dev: DEV_PROFILE }),
  auth,
  knownProject: (dir) => knownProject(dir, projectPaths()),
  log: (line) => console.log(line),
});
registerAuthIpc({
  ipc: ipcMain,
  fromWorkspace,
  auth,
  broadcast: (channel, payload) => {
    for (const contents of trusted) if (!contents.isDestroyed()) contents.send(channel, payload);
  },
});

const updater = createUpdater({
  packaged: app.isPackaged && !DEV_PROFILE,
  platform: process.platform,
  arch: process.arch,
  version: app.getVersion(),
  enabled: () => settingsStore.get('updates.checkAutomatically'),
  fetch: (url, { headers, signal }) => electron.net.fetch(url, { headers, signal }),
  native: process.platform === 'darwin' ? squirrelUpdater(electron.autoUpdater as unknown as AutoUpdaterLike) : null,
  activity: async () => ({
    agentRunning: agent.isRunning() || prExplain.running() > 0,
    processes: await readProcessActivity({ platform: process.platform, supportedPlatforms: MEMORY_SUPPORTED_PLATFORMS, run: runCommand, rootPid: process.pid }),
  }),
  log: (severity, message, detail) => reportDiagnostic({ source: 'app', severity, message, detail }),
  publish: (notice) => {
    for (const contents of trusted) if (!contents.isDestroyed()) contents.send(UPDATE_NOTICE_CHANNEL, notice);
  },
  confirmRestart: async (live) => {
    const confirm = restartDialog(live);
    const options: Electron.MessageBoxOptions = { type: 'warning', message: confirm.message, detail: confirm.detail, buttons: [confirm.confirm, confirm.cancel], defaultId: 1, cancelId: 1 };
    const focused = BrowserWindow.getFocusedWindow();
    const { response } = await (focused ? dialog.showMessageBox(focused, options) : dialog.showMessageBox(options));
    return response === 0;
  },
  openRelease: (url) => void shell.openExternal(url),
  timers: {
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    every: (ms, run) => {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
  },
});
const checkForUpdates = createUpdateController({
  updater,
  version: app.getVersion(),
  showResult: async (result) => {
    const options: Electron.MessageBoxOptions = { type: 'info', message: result.message, detail: result.detail, buttons: result.buttons.map((button) => button.label), defaultId: 0, cancelId: result.buttons.length - 1 };
    const focused = BrowserWindow.getFocusedWindow();
    const { response } = await (focused ? dialog.showMessageBox(focused, options) : dialog.showMessageBox(options));
    return result.buttons[response]?.action ?? 'close';
  },
  openExternal: (url) => shell.openExternal(url),
});
registerUpdateIpc({ handle: (channel, listener) => ipcMain.handle(channel, listener), fromWorkspace, updater });

let runOwner: Electron.WebContents | null = null;

ipcMain.handle(MEMORY_WATCH_CHANNEL, fromWorkspace((e, on: unknown) => memoryService.handle(e.sender, on)));
ipcMain.handle(MEMORY_FREE_CHANNEL, fromWorkspace((_e, value: unknown) => releaseProjectMemory(value)));
ipcMain.handle('ws:info', fromWorkspace(() => serveweb.status()));
ipcMain.handle('app:dev-instance', fromWorkspace(() => INSTANCE));
ipcMain.handle('ws:restart-editor', fromWorkspace(() => {
  serveweb.recycle();
  editorDemand.request();
  pushState();
  return serveweb.status();
}));
ipcMain.handle('ws:need-editor', fromWorkspace(() => {
  editorDemand.request();
  pushState();
  return serveweb.status();
}));
ipcMain.handle('ws:projects', fromWorkspace(() => projects.groups()));
ipcMain.handle('ws:add-folder', fromWorkspace(async (e) => {
  const res = await showOpenDialogFor(e.sender, { title: 'Add a project folder', properties: ['openDirectory'] });
  let selectedPath: string | null = null;
  if (!res.canceled && res.filePaths.length) {
    selectedPath = res.filePaths[0];
    projects.add(selectedPath);
    pushState();
  }
  return { groups: projects.groups(), selectedPath };
}));
ipcMain.handle('ws:add-path', fromWorkspace((_e, dir) => { projects.add(dir); pushState(); return projects.groups(); }));
ipcMain.handle('ws:hide', fromWorkspace((_e, dir) => { projects.hide(dir); pushState(); return projects.groups(); }));
ipcMain.on('ws:opened', fromWorkspace((e, { path: dir, name } = {}) => {
  if (!dir) return;
  projects.markOpened(dir, name);
  installOnOpen(dir, { provider: settings.provider(dir) });
  if (isRegisteredDir(dir)) void warmPrs(dir);
  if (!ownsProject(e.sender, dir)) projects.add(dir); // opening a project remembers it, except in its own window, which only lists it while open
  pushState();
}));

const providerOf = (project: unknown) => (typeof project === 'string' && project ? settings.provider(project) : 'claude');
ipcMain.handle('skills:list', fromWorkspace((_e, project) => skills.listFor(project, providerOf(project))));
const isSkillsRequest = (r: any): r is { project: string; names: string[] } =>
  typeof r?.project === 'string' && Array.isArray(r.names) && r.names.every((n: unknown) => typeof n === 'string');
ipcMain.handle('skills:link', fromWorkspace((_e, req) => {
  if (!isSkillsRequest(req)) return { ...skills.listFor(null), linkResults: {} };
  const provider = providerOf(req.project);
  const linkResults = skills.link(req.project, req.names, provider);
  return { ...skills.listFor(req.project, provider), linkResults };
}));
ipcMain.handle('skills:unlink', fromWorkspace((_e, req) => {
  if (!isSkillsRequest(req)) return skills.listFor(null);
  const provider = providerOf(req.project);
  skills.unlink(req.project, req.names, provider);
  return skills.listFor(req.project, provider);
}));
const installedFor = (project: unknown) => skills.installedNames(typeof project === 'string' && project ? project : null, providerOf(project));
const reinstallFor = (project: unknown) => (typeof project === 'string' && project ? reinstallOf(project, { provider: settings.provider(project) }) : null);
const syncPermissionsFor = (project: unknown) => (typeof project === 'string' && project ? syncPermissionsOf(project, { provider: settings.provider(project) }) : null);
registerExtensionsIpc({
  handle: (channel, handler) => ipcMain.handle(channel, handler),
  fromWorkspace,
  installedFor,
  reinstallFor,
  syncPermissionsFor,
  pickList: async (sender) => {
    const res = await showOpenDialogFor(sender as Electron.WebContents, { title: 'Import a list of extra skills', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  },
});
ipcMain.handle('skills:choose-dir', fromWorkspace(async (e) => {
  const res = await showOpenDialogFor(e.sender, {
    title: 'Choose where to clone the skills repo (or pick an existing checkout)',
    defaultPath: skills.defaultCloneParent(),
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
}));
ipcMain.handle('skills:clone', fromWorkspace((_e, dir, remote) => skills.clone(dir, typeof remote === 'string' ? remote : '')));
ipcMain.handle('skills:sync', fromWorkspace(() => skills.sync()));
ipcMain.handle('skills:reveal', fromWorkspace(() => shell.openPath(skills.repoPath())));
ipcMain.handle('mic:fix', fromWorkspace((e) => enableMicrophone({ confirm: () => confirmMicPatch(e.sender), apply: serveweb.applyPatch, recycle: serveweb.recycle })));

ipcMain.handle('project:read-file', fromWorkspace((_e, { project, file } = {}) => readProjectFile(project, file)));
ipcMain.handle('project:ident', fromWorkspace((_e, project: unknown) => projectIdent(registeredProject(project, projectPaths()))));
ipcMain.handle('code:semantic-highlight', fromWorkspace(async (_e, request: SemanticHighlightRequest) => {
  const canonical = (value: string) => { try { return fs.realpathSync(value); } catch { return ''; } };
  const registered = typeof request?.project === 'string' && projects.groups().some((group) => canonical(group.path) === canonical(request.project));
  if (!registered) return { ok: false, source: request?.source, spans: [], reason: 'not a registered project' };
  try {
    return await semanticService.highlight(request);
  } catch (error) {
    return { ok: false, source: request.source, spans: [], reason: (error as Error).message };
  }
}));

ipcMain.handle('explains:list', fromWorkspace((_e, project) => explains.list(project)));
ipcMain.handle('explains:remove', fromWorkspace((_e, { project, name } = {}) => explains.remove(project, name)));

ipcMain.handle('lantern:load', fromWorkspace(async (_e, project, lang, fresh) => {
  const dir = lantern.requireProject(project);
  const local = settings.localReviews(dir);
  return withLocalPrs(dir, await lantern.loadGraph(dir, typeof lang === 'string' ? lang : undefined, fresh === true), local, local.length ? localReasons.lookup(dir) : undefined);
}));
ipcMain.handle('lantern:coverage', fromWorkspace((_e, project, fresh) => lantern.loadCoverage(lantern.requireProject(project), fresh === true)));
ipcMain.handle('lantern:stamp', fromWorkspace(async (_e, project) => {
  const dir = lantern.requireProject(project);
  const stamp = await lanternStamp(dir);
  return hasWorktree(settings.localReviews(dir)) ? `${stamp}:${await worktreeStamp(dir)}` : stamp;
}));
const isRegisteredDir = (dir: string) => projects.groups().some((g) => path.resolve(g.path) === path.resolve(dir));
ipcMain.handle('lantern:compare-refs', fromWorkspace((_e, project) => {
  const dir = lantern.requireProject(project);
  return isRegisteredDir(dir) ? compareRefs(dir) : { branches: [], base: 'HEAD', current: 'HEAD', dirty: 0 };
}));
ipcMain.handle('lantern:compare-commits', fromWorkspace((_e, { project, ref } = {}) => {
  const dir = lantern.requireProject(project);
  return isRegisteredDir(dir) ? compareCommits(dir, ref) : [];
}));
ipcMain.handle('lantern:compare-stat', fromWorkspace((_e, { project, base, head } = {}) => {
  const dir = lantern.requireProject(project);
  return isRegisteredDir(dir) ? compareStat(dir, base, head) : { ok: false, files: 0, add: 0, del: 0, error: 'not a registered project' };
}));
ipcMain.handle('lantern:local-reasons', fromWorkspace((_e, { project, id } = {}) => {
  const dir = lantern.requireProject(project);
  return isRegisteredDir(dir) && typeof id === 'string' ? localReasons.generate(dir, id) : { ok: false, error: 'not a registered project' };
}));
ipcMain.handle('lantern:progress', fromWorkspace((_e, project, mode) => {
  const dir = lantern.requireProject(project);
  return readSetupState({ project: dir, language: mapLanguage(dir), mode: mode === 'live' || mode === 'fresh' ? mode : undefined, settings, readProgress });
}));
ipcMain.handle('lantern:count', fromWorkspace((_e, project) => lantern.count(lantern.requireProject(project))));
ipcMain.handle('lantern:fetch-prs', fromWorkspace((_e, project, force) => {
  const dir = lantern.requireProject(project);
  return isRegisteredDir(dir) ? lantern.fetchPrs(dir, force === true) : { ok: false, error: 'not a registered project' };
}));
ipcMain.handle('lantern:refresh-prs', fromWorkspace((_e, project) => {
  const dir = lantern.requireProject(project);
  return isRegisteredDir(dir) ? refreshPrData(dir) : { ok: false, error: 'not a registered project' };
}));
ipcMain.handle('lantern:enter-pr', fromWorkspace((_e, project, pr) => {
  const dir = lantern.requireProject(project);
  return isRegisteredDir(dir) && typeof pr === 'string' ? enterPr(dir, pr) : { changed: false };
}));
ipcMain.handle('lantern:macro', fromWorkspace((_e, project, lang) =>
  readRegisteredMacro(isRegisteredDir, lantern.loadMacro, project, lang)));
ipcMain.handle('lantern:pr-file-diff', fromWorkspace((_e, { project, pr, file, sides } = {}) =>
  readRegisteredPrFileDiff(isRegisteredDir, project, pr, file, sides)));
ipcMain.handle('lantern:pr-file-stats', fromWorkspace((_e, { project, pr } = {}) =>
  readRegisteredPrFileStats(isRegisteredDir, project, pr)));
ipcMain.handle('lantern:pr-overlay', fromWorkspace((_e, { project, pr, lang } = {}) =>
  loadRegisteredPrOverlay(isRegisteredDir, project, pr, typeof lang === 'string' ? lang : undefined)));
ipcMain.handle('lantern:pr-file', fromWorkspace((_e, { project, pr, file } = {}) =>
  readRegisteredPrFile(isRegisteredDir, project, pr, file)));
ipcMain.handle(PR_EXPLAIN_START, fromWorkspace((e, request: unknown) => {
  const sender = e.sender; // the window that pressed the button gets the answer
  return prExplain.start(request, (done: PrExplainDone) => {
    if (!sender.isDestroyed()) sender.send(PR_EXPLAIN_DONE, done);
  });
}));
ipcMain.handle(PR_EXPLAIN_CANCEL, fromWorkspace((_e, request: unknown) => prExplain.cancel(request)));
ipcMain.handle(PR_EXPLAIN_SAVED, fromWorkspace((_e, request: unknown) => prExplain.saved(request)));
ipcMain.handle('agent:run', fromWorkspace(async (e, { project, kind, target }: { project: string; kind: agent.AgentKind; target?: string }) => {
  await settledFor(project);
  const provider = providerOf(project);
  if (provider === 'codex' && !safeAgentRequest({ project, kind, target }, projectPaths())) return { ok: false, error: 'Invalid agent request' };
  // A fix or a map build reads files directly, so a fresh session is cleaner than
  // resuming the conversation that produced the mistake.
  const fresh = kind === 'plan-fix' || kind === 'lantern' || kind === 'lantern-refresh';
  const latest = fresh ? null : provider === 'codex' ? state.latest(project, provider, projects.rootForCwd) : state.all().find((s) => s.provider === 'claude' && s.cwd === project && s.sessionId);
  const isLanternKind = kind === 'lantern' || kind === 'lantern-refresh';
  const sender = e.sender; // stream back to the window that started the run (main or a pop-out)
  let runnerSessionId = '';
  const credentialEnv = await auth.injectionFor(project).catch(() => ({}));
  const res = agent.start({
    project,
    kind,
    target,
    provider,
    credentialEnv,
    language: mapLanguage(project),
    sessionId: (provider === 'codex' ? latest?.id : latest?.sessionId) || null,
    onSessionId: provider === 'codex'
      ? (id) => {
          runnerSessionId = id;
          state.upsertRunnerSession(provider, id, project);
          pushState();
        }
      : undefined,
    onEvent: (event) => {
      if (event.kind === 'done' || event.kind === 'error' || event.kind === 'cancelled') runOwner = null;
      if (runnerSessionId && (event.kind === 'done' || event.kind === 'error' || event.kind === 'cancelled')) {
        state.finishRunnerSession(provider, runnerSessionId, event.kind === 'done' && !!event.ok);
        pushState();
      }
      if (provider === 'codex' && (event.kind === 'done' || event.kind === 'error' || event.kind === 'cancelled')) pushAgentStatus();
      if (event.kind === 'done' && event.ok && isLanternKind) void settleSetup({ project, language: mapLanguage(project), settings, readProgress });
      if (!sender.isDestroyed()) sender.send('agent:event', event);
    },
  });
  if (res.ok) {
    runOwner = sender;
    sender.once('destroyed', () => {
      if (runOwner === sender) runOwner = null;
    });
  }
  if (res.ok && isLanternKind) settings.markSetup(project, kind);
  if (res.ok && provider === 'codex') pushAgentStatus();
  return { ...res, resumed: !!latest, provider };
}));
ipcMain.handle('agent:cancel', fromWorkspace(async (e) => {
  if (agent.isRunning() && runOwner && runOwner !== e.sender) return false;
  const codexRun = agent.runningProvider() === 'codex';
  await agent.cancel();
  if (codexRun) pushAgentStatus();
  return true;
}));
ipcMain.handle('cli:status', fromWorkspace(() => (process.platform === 'darwin' ? cli.status(cliScript) : userCliStatus(cliContext()))));
// A dev run's script lives in out/, which the next build replaces: never link the CLI to it.
ipcMain.handle('cli:install', fromWorkspace(() => {
  if (DEV_PROFILE) return null;
  return process.platform === 'darwin' ? cli.install(cliScript) : installUserCli(cliContext());
}));
ipcMain.handle('cli:uninstall', fromWorkspace(() => {
  if (DEV_PROFILE) return null;
  return process.platform === 'darwin' ? cli.uninstall(cliScript) : uninstallUserCli(cliContext());
}));
ipcMain.handle('rtk:status', fromWorkspace((_e, project: unknown) => rtkStatus(project, projectPaths())));
ipcMain.handle('popout:open', fromWorkspace((e, { tool, project }: { tool: string; project: string }) => { popout.open(tool, project, e.sender); return true; }));
ipcMain.handle('agent:status', fromWorkspace((_e, project: unknown) => {
  const provider = providerOf(project);
  return { running: agent.isRunning(), available: agent.isAvailable(provider), provider };
}));

ipcMain.handle('settings:get', fromWorkspace(() => settings.all()));

ipcMain.handle('settings:provider', fromWorkspace((_e, value: unknown) => {
  const project = registeredProject(value, projectPaths());
  return project ? settings.provider(project) : 'claude';
}));
ipcMain.handle('settings:set-provider', fromWorkspace((_e, value: unknown) => {
  const arg = value && typeof value === 'object' ? value as { project?: unknown; provider?: unknown } : {};
  const project = registeredProject(arg.project, projectPaths());
  if (!project || !isProvider(arg.provider) || agent.isRunning()) return settings.all();
  const next = settings.setProvider(project, arg.provider);
  pushProvider(project, arg.provider);
  return next;
}));
ipcMain.handle('codex-hooks:status', fromWorkspace(() => codexHookResult(() => codexHooks.status(codexHookPaths()))));
ipcMain.handle('codex-hooks:install', fromWorkspace(() => codexHookResult(() => {
  if (DEV_PROFILE) throw new Error('A dev run does not install Codex hooks: they would keep calling its port after it quits.');
  return codexHooks.install(codexHookPaths());
})));
ipcMain.handle('codex-hooks:uninstall', fromWorkspace(() => codexHookResult(() => codexHooks.uninstall(codexHookPaths()))));

ipcMain.handle(
  'settings:dismiss-pr',
  fromWorkspace((_e, arg: { project: unknown; id: unknown }) => (typeof arg?.project === 'string' && typeof arg?.id === 'string' ? settings.dismissPr(arg.project, arg.id) : settings.all())),
);
ipcMain.handle(
  'settings:add-local-review',
  fromWorkspace((_e, arg: { project: unknown; id: unknown }) => (typeof arg?.project === 'string' && typeof arg?.id === 'string' && isRegisteredDir(arg.project) ? settings.addLocalReview(arg.project, arg.id) : settings.all())),
);
ipcMain.handle(
  'settings:remove-local-review',
  fromWorkspace((_e, arg: { project: unknown; id: unknown }) => (typeof arg?.project === 'string' && typeof arg?.id === 'string' && isRegisteredDir(arg.project) ? settings.removeLocalReview(arg.project, arg.id) : settings.all())),
);
ipcMain.handle('settings:restore-prs', fromWorkspace((_e, project: unknown) => (typeof project === 'string' ? settings.restorePrs(project) : settings.all())));

const MALFORMED_SETTINGS_UPDATE: SettingsUpdateResult = { ok: false, error: 'Expected an object with a key and a value' };
ipcMain.handle('settings:snapshot', fromWorkspace(() => settingsStore.snapshot()));
ipcMain.handle(
  'settings:update',
  fromWorkspace((_e, arg: unknown) =>
    typeof arg === 'object' && arg !== null && 'key' in arg && 'value' in arg ? settingsStore.update(arg.key, arg.value) : MALFORMED_SETTINGS_UPDATE,
  ),
);
ipcMain.handle(
  'settings:open-file',
  fromWorkspace(() => {
    settingsStore.ensureFile();
    return shell.openPath(settingsStore.file());
  }),
);
settingsStore.onDidChange((snapshot, changed) => {
  for (const wc of trusted) if (!wc.isDestroyed()) wc.send('settings:changed', { snapshot, changed } satisfies SettingsChange);
  if (affectsSetting('notifications', changed)) refreshTray();
  if (affectsSetting('updates', changed)) updater.settingsChanged();
  if (affectsSetting('keymap', changed)) {
    commandKeys.refresh();
    refreshMenu();
  }
});

let quitting = false;

const quitWithoutReachableTray = createLastWindowHandler({
  platform: process.platform,
  env: process.env,
  trayCreated: () => tray !== null,
  isQuitting: () => quitting,
  quit: () => app.quit(),
});
app.on('window-all-closed', quitWithoutReachableTray);

// Quit waits for the serve-web tree to die; the second app.quit() passes straight through.
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  currentDiagnostics()?.markQuit();
  if (server) server.close();
  settingsStore.unwatch();
  updater.stop();
  prExplain.cancelAll();
  e.preventDefault();
  Promise.allSettled([serveweb.shutdown(), semanticService.dispose(), credentialServer.close()]).finally(() => app.quit());
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit());
