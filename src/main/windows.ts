import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';
import type { NativeImage, WebContents } from 'electron';
import { installOnOpen } from './bundle';
import * as cli from './cli';
import * as popout from './popout';
import * as projects from './projects';
import { checkoutTop } from './projectroot';
import * as settings from './settings';

type Win = InstanceType<typeof BrowserWindow>;

interface Host {
  preload: string;
  htmlDir: string;
  dockIcon: NativeImage;
  windowIcon?: string;
  trust: (wc: WebContents) => void;
  untrust: (wc: WebContents) => void;
  mainWindow: () => Win | null;
  onIdle?: () => void;
}

const BG = '#040d23'; // matches the renderer so there's no white launch flash
const WIN_SIZE = { w: 1320, h: 860 };

const projectWins = new Map<string, Win>();
let host: Host | null = null;

function init(h: Host) {
  host = h;
}

function requireHost() {
  if (!host) throw new Error('windows.init() has not run');
  return host;
}

function isOpen(win: Win | null | undefined): win is Win {
  return !!win && !win.isDestroyed();
}

// win.focus() alone leaves the menu bar with the previous app on macOS, notably
// after `open -n`, where the short-lived second instance was the active app.
function raise(win: Win) {
  win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function focusWin(win: Win | null | undefined) {
  if (!isOpen(win)) return false;
  raise(win);
  return true;
}

function showDock() {
  if (!app.dock) return Promise.resolve();
  if (!requireHost().dockIcon.isEmpty()) app.dock.setIcon(requireHost().dockIcon);
  return app.dock.show();
}

function hideDockIfIdle() {
  if (isOpen(requireHost().mainWindow()) || projectWins.size || popout.hasOpen()) return;
  app.dock?.hide();
  requireHost().onIdle?.();
}

const SERVE_WEB_HOST = '127.0.0.1';

function isServeWebUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === SERVE_WEB_HOST && u.port !== '';
  } catch {
    return false;
  }
}

function isAppUrl(url: string, htmlDir: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && u.href.startsWith(`${pathToFileURL(htmlDir).href.replace(/\/$/, '')}/`);
  } catch {
    return false;
  }
}

function onAttachWebview(event: { preventDefault: () => void }, webPreferences: Record<string, unknown>, params: Record<string, unknown>) {
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  if (typeof params.src !== 'string' || !isServeWebUrl(params.src)) event.preventDefault();
}

function hardenWebContents(wc: WebContents, htmlDir: string) {
  wc.on('will-attach-webview', onAttachWebview as never);
  wc.on('will-navigate', ((event: { preventDefault: () => void }, url: string) => {
    if (!isAppUrl(url, htmlDir)) event.preventDefault();
  }) as never);
}

function newWorkspaceWindow(title: string) {
  const h = requireHost();
  const win = new BrowserWindow({
    width: WIN_SIZE.w,
    height: WIN_SIZE.h,
    minWidth: 640,
    minHeight: 480,
    title,
    show: false,
    backgroundColor: BG,
    ...(h.windowIcon ? { icon: h.windowIcon } : {}),
    // Inset traffic-lights on macOS; a normal frame elsewhere (hiddenInset is a no-op
    // off-Mac and would leave the custom drag strip looking broken).
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: h.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  const wc = win.webContents; // capture now; can't read .webContents in 'closed' (window is destroyed)
  h.trust(wc);
  hardenWebContents(wc, h.htmlDir);
  const docked = showDock();
  win.once('ready-to-show', () => docked.finally(() => focusWin(win)));
  win.on('closed', () => {
    h.untrust(wc);
    popout.closeOpenedBy(wc);
  });
  return win;
}

function realPath(dir: string) {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return dir;
  }
}

// One key per checkout: a symlink, a trailing slash or a subfolder lands on the
// window that already shows it.
function projectKey(cwd: string) {
  return checkoutTop(realPath(cwd));
}

function focusProjectWindow(cwd: string, root?: string) {
  const keys = root ? [projectKey(cwd), projectKey(root)] : [projectKey(cwd)];
  return focusWin(keys.map((key) => projectWins.get(key)).find(isOpen));
}

function openProjectWindow(cwd: string, compare: string | null = null) {
  const h = requireHost();
  const root = projectKey(cwd);
  if (compare) settings.addLocalReview(root, compare);
  const open = projectWins.get(root);
  if (focusWin(open)) {
    if (compare) open?.webContents.send('lantern:show-compare', { project: root, id: compare });
    return;
  }
  const win = newWorkspaceWindow(path.basename(root));
  projectWins.set(root, win);
  projects.attach(root);
  installOnOpen(root, { provider: settings.provider(root) });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadFile(path.join(h.htmlDir, 'workspace.html'), { query: compare ? { project: root, compare } : { project: root } });
  win.on('closed', () => {
    projectWins.delete(root);
    projects.detach(root);
    hideDockIfIdle();
  });
}

function openFromArgv(argv: readonly string[], cwd: string, fallback?: () => void) {
  const dir = cli.projectArg(argv, cwd);
  if (dir) openProjectWindow(dir, cli.compareArg(argv));
  else fallback?.();
}

function ownsProject(wc: WebContents, dir: string) {
  const win = projectWins.get(projectKey(dir));
  return isOpen(win) && win.webContents === wc;
}

function windowOpenHandler(openExternal: (url: string) => unknown) {
  return ({ url }: { url: string }) => {
    if (/^https?:\/\//i.test(url)) openExternal(url);
    return { action: 'deny' as const };
  };
}

export { isServeWebUrl, isAppUrl, onAttachWebview, hardenWebContents, windowOpenHandler, init, projectWins, isOpen, raise, focusWin, showDock, hideDockIfIdle, newWorkspaceWindow, projectKey, focusProjectWindow, openProjectWindow, openFromArgv, ownsProject };
