import path from 'node:path';
import { BrowserWindow, type IpcMainEvent, ipcMain, screen, systemPreferences } from 'electron';
import { parseTrayAction, type TrayAction } from '@shared/tray-action';
import type { TrayModel } from '@shared/tray-model';
import { maxPopoverHeight, POPOVER_WIDTH, popoverBounds, shouldOpen } from './tray-placement';

interface PopoverOptions {
  model: () => TrayModel;
  onOpenProject: (projectPath: string) => void;
  onAction: (action: TrayAction) => void;
}

const FADE_MS = 120;
const FRAME_MS = 16;
const BLUR_GRACE_MS = 120;
const REVEAL_FALLBACK_MS = 150;

let options: PopoverOptions | null = null;
let win: BrowserWindow | null = null;
let ready = false;
let anchor: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 };
let height = 1;
let lastModel: TrayModel | null = null;
let lastSent = '';
let hiddenAt = 0;
let shownAt = 0;
let revealing = false;
let revealTimer: NodeJS.Timeout | null = null;
let fadeTimer: NodeJS.Timeout | null = null;
let pending: { channel: string; payload: unknown } | null = null;

function workAreaFor(rect: Electron.Rectangle) {
  const empty = rect.width === 0 && rect.height === 0;
  return (empty ? screen.getPrimaryDisplay() : screen.getDisplayMatching(rect)).workArea;
}

function moving() {
  return !systemPreferences.getAnimationSettings().prefersReducedMotion;
}

function place() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(popoverBounds(anchor, height, workAreaFor(anchor)));
}

function fadeIn(w: BrowserWindow) {
  if (fadeTimer) clearTimeout(fadeTimer);
  if (!moving()) return w.setOpacity(1);
  const start = Date.now();
  const step = () => {
    if (w.isDestroyed()) return;
    const t = Math.min(1, (Date.now() - start) / FADE_MS);
    w.setOpacity(1 - (1 - t) ** 3);
    fadeTimer = t < 1 ? setTimeout(step, FRAME_MS) : null;
  };
  step();
}

function reveal() {
  if (!win || win.isDestroyed() || !revealing) return;
  revealing = false;
  if (revealTimer) clearTimeout(revealTimer);
  win.setOpacity(0);
  place();
  shownAt = Date.now();
  win.show();
  win.focus();
  fadeIn(win);
}

function hide() {
  revealing = false;
  if (revealTimer) clearTimeout(revealTimer);
  if (fadeTimer) clearTimeout(fadeTimer);
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.hide();
  hiddenAt = Date.now();
}

function armReveal() {
  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = setTimeout(reveal, REVEAL_FALLBACK_MS);
}

function send(channel: string, payload: unknown) {
  if (!win || win.isDestroyed()) return;
  if (!ready) {
    pending = { channel, payload };
    return;
  }
  win.webContents.send(channel, payload);
  if (revealing) armReveal();
}

// An NSPanel joins the current Space and floats over full-screen apps, like a system menu.
function ensure() {
  if (win && !win.isDestroyed()) return win;
  const w = new BrowserWindow({
    width: POPOVER_WIDTH,
    height,
    type: 'panel',
    frame: false,
    transparent: true,
    vibrancy: 'hud',
    visualEffectState: 'active',
    roundedCorners: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload', 'tray-popover.js'), contextIsolation: true, sandbox: true },
  });
  win = w;
  w.setAlwaysOnTop(true, 'pop-up-menu');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  ready = false;
  w.webContents.once('did-finish-load', () => {
    ready = true;
    if (!pending) return;
    const { channel, payload } = pending;
    pending = null;
    send(channel, payload);
  });
  w.webContents.on('will-navigate', (event) => event.preventDefault());
  w.on('blur', () => {
    if (Date.now() - shownAt > BLUR_GRACE_MS) hide();
  });
  w.on('closed', () => {
    win = null;
    ready = false;
    revealing = false;
  });
  w.loadFile(path.join(__dirname, 'renderer', 'tray-popover.html'));
  return w;
}

function open(at: Electron.Rectangle) {
  if (!options) return;
  anchor = at;
  ensure();
  lastModel = options.model();
  lastSent = JSON.stringify(lastModel);
  revealing = true;
  send('tray:open', { model: lastModel, maxHeight: maxPopoverHeight(anchor, workAreaFor(anchor)) });
}

function toggle(at: Electron.Rectangle) {
  if (win && !win.isDestroyed() && win.isVisible()) return hide();
  if (!shouldOpen(hiddenAt, Date.now())) return;
  open(at);
}

function update() {
  if (!options || !win || win.isDestroyed() || !win.isVisible()) return;
  const next = options.model();
  const serialized = JSON.stringify(next);
  if (serialized === lastSent) return;
  lastSent = serialized;
  lastModel = next;
  send('tray:model', next);
}

function fromPopover<A extends unknown[]>(handler: (...args: A) => void) {
  return (e: IpcMainEvent, ...args: A) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents) handler(...args);
  };
}

function knownProject(value: unknown): value is string {
  return typeof value === 'string' && !!lastModel?.sections.some((section) => section.rows.some((row) => row.path === value));
}

function init(opts: PopoverOptions) {
  options = opts;
  screen.on('display-added', hide);
  screen.on('display-removed', hide);
  screen.on('display-metrics-changed', hide);
  ipcMain.on(
    'tray:resize',
    fromPopover((h: unknown) => {
      if (typeof h !== 'number' || !Number.isFinite(h)) return;
      height = Math.max(1, Math.ceil(h));
      if (revealing) return reveal();
      if (win?.isVisible()) place();
    }),
  );
  ipcMain.on('tray:close', fromPopover(hide));
  ipcMain.on(
    'tray:open-project',
    fromPopover((projectPath: unknown) => {
      if (!knownProject(projectPath)) return;
      hide();
      opts.onOpenProject(projectPath);
    }),
  );
  ipcMain.on(
    'tray:action',
    fromPopover((id: unknown) => {
      const action = parseTrayAction(id, lastModel?.tests.map((test) => test.kind) ?? []);
      if (!action) return;
      hide();
      opts.onAction(action);
    }),
  );
}

export { init, toggle, update };
