import path from 'node:path';
import { BrowserWindow, type Display, type IpcMainEvent, ipcMain, screen, systemPreferences } from 'electron';
import type { CardKind, NotificationCard } from './session-notification';
import type { NotificationPosition, NotificationTimbre } from '../shared/settings-notifications';

const WIDTH = 440;
const TOP_MARGIN = 16;
const SIDE_MARGIN = 16;
const HIDE_BELOW = 40;
const FOLLOW_INTERVAL_MS = 150;
const FRAME_MS = 16;
const ENTER = { ms: 380, rise: 22 };
const EXIT = { ms: 200, rise: 8 };
const HOP_OUT_MS = 140;
const HOP_IN_MS = 180;

interface CardPrefs {
  animations: boolean;
  dismissMs: number;
  volume: number;
  timbre: NotificationTimbre;
}

interface OverlayOptions {
  onOpen: (card: NotificationCard) => void;
  onJump: (card: NotificationCard) => void;
  prefs: (kind: CardKind) => CardPrefs;
  followCursor: () => boolean;
  animations: () => boolean;
  position: () => NotificationPosition;
}

let options: OverlayOptions | null = null;
let win: BrowserWindow | null = null;
let ready = false;
const pending: unknown[] = [];
let display: Display | null = null;
let height = 1;
let followTimer: NodeJS.Timeout | null = null;
let motion: NodeJS.Timeout | null = null;
let offsetY = 0;

function anchorIn(workArea: Electron.Rectangle, h: number, dy = 0, position: NotificationPosition = 'center') {
  const x = {
    left: workArea.x + SIDE_MARGIN,
    center: workArea.x + (workArea.width - WIDTH) / 2,
    right: workArea.x + workArea.width - WIDTH - SIDE_MARGIN,
  }[position];
  return { x: Math.round(x), y: Math.round(workArea.y + TOP_MARGIN + dy), width: WIDTH, height: h };
}

function targetDisplay(): Display {
  if (!options?.followCursor()) return screen.getPrimaryDisplay();
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function moving(): boolean {
  return Boolean(options?.animations()) && !systemPreferences.getAnimationSettings().prefersReducedMotion;
}

function place() {
  if (!win || win.isDestroyed()) return;
  display ??= targetDisplay();
  win.setBounds(anchorIn(display.workArea, height, offsetY, options?.position()));
}

const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

// The native blur belongs to the window, so the window itself fades and slides, not the page.
function tween(ms: number, from: { opacity: number; dy: number }, to: { opacity: number; dy: number }, ease: (t: number) => number, then?: () => void) {
  if (motion) clearInterval(motion);
  motion = null;
  const w = win;
  if (!w || w.isDestroyed()) return;
  const start = Date.now();
  const step = () => {
    if (w.isDestroyed()) return;
    const t = Math.min(1, (Date.now() - start) / ms);
    const k = ease(t);
    w.setOpacity(from.opacity + (to.opacity - from.opacity) * Math.min(1, easeOut(t)));
    offsetY = from.dy + (to.dy - from.dy) * k;
    place();
    if (t < 1) return;
    if (motion) clearInterval(motion);
    motion = null;
    then?.();
  };
  step();
  if (motion === null && Date.now() - start < ms) motion = setInterval(step, FRAME_MS);
}

function jump(opacity: number) {
  if (motion) clearInterval(motion);
  motion = null;
  offsetY = 0;
  if (!win || win.isDestroyed()) return;
  win.setOpacity(opacity);
  place();
}

function animate(direction: 'in' | 'out', still: boolean) {
  if (still || !moving()) return jump(direction === 'in' ? 1 : 0);
  if (direction === 'in') tween(ENTER.ms, { opacity: 0, dy: -ENTER.rise }, { opacity: 1, dy: 0 }, easeOutBack);
  else tween(EXIT.ms, { opacity: win?.getOpacity() ?? 1, dy: offsetY }, { opacity: 0, dy: -EXIT.rise }, easeOut);
}

function followCursor() {
  if (!win || win.isDestroyed() || !win.isVisible() || motion) return;
  if (screen.getAllDisplays().length < 2) return;
  const next = targetDisplay();
  if (!display || next.id === display.id) return;
  if (!moving()) {
    display = next;
    return place();
  }
  tween(HOP_OUT_MS, { opacity: win.getOpacity(), dy: 0 }, { opacity: 0, dy: 0 }, easeOut, () => {
    display = next;
    tween(HOP_IN_MS, { opacity: 0, dy: 0 }, { opacity: 1, dy: 0 }, easeOut);
  });
}

function startFollowing() {
  followTimer ??= setInterval(followCursor, FOLLOW_INTERVAL_MS);
}

function stopFollowing() {
  if (followTimer) clearInterval(followTimer);
  followTimer = null;
}

function reset() {
  stopFollowing();
  if (motion) clearInterval(motion);
  motion = null;
  offsetY = 0;
}

// Frameless, non-focusable panel on the current Space with the system HUD blur behind
// it; the renderer flips mouse interactivity on only while the pointer is over the card.
function ensure() {
  if (win && !win.isDestroyed()) return win;
  const w = new BrowserWindow({
    ...anchorIn(screen.getPrimaryDisplay().workArea, 120, 0, options?.position()),
    // A plain window of an app that toggles its dock icon stays on the Space it last showed on; an NSPanel joins the current one.
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
    focusable: false,
    hasShadow: false, // the native shadow draws a fixed-strength outline; the card draws a fainter one
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'overlay.js'),
      contextIsolation: true,
      sandbox: true,
      // Sounds play when a card arrives, never after a click in this window.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win = w;
  w.setAlwaysOnTop(true, 'floating'); // above normal windows, below OS notifications
  // Without skipTransformProcessType this call hides the dock icon of an open workspace.
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  w.setIgnoreMouseEvents(true, { forward: true });
  w.setOpacity(0);
  ready = false;
  w.webContents.once('did-finish-load', () => {
    ready = true;
    while (pending.length) w.webContents.send('overlay:card', pending.shift());
  });
  w.webContents.on('render-process-gone', () => {
    reset();
    if (!w.isDestroyed()) w.destroy();
  });
  w.on('closed', () => {
    win = null;
    ready = false;
    reset();
  });
  w.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  return w;
}

function show(card: NotificationCard) {
  if (!options) return;
  const w = ensure();
  if (!w.isVisible()) {
    display = targetDisplay();
    place();
  }
  w.showInactive();
  if (options.followCursor()) startFollowing();
  else stopFollowing();
  const payload = { ...card, prefs: options.prefs(card.kind) };
  if (ready) w.webContents.send('overlay:card', payload);
  else pending.push(payload);
}

function fromOverlay<A extends unknown[]>(handler: (...args: A) => void) {
  return (e: IpcMainEvent, ...args: A) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents) handler(...args);
  };
}

function forgetDisplay() {
  display = null;
  if (win && !win.isDestroyed() && win.isVisible()) {
    display = targetDisplay();
    place();
  }
}

function init(opts: OverlayOptions) {
  options = opts;
  screen.on('display-added', forgetDisplay);
  screen.on('display-removed', forgetDisplay);
  screen.on('display-metrics-changed', forgetDisplay);
  ipcMain.on(
    'overlay:resize',
    fromOverlay((h: unknown) => {
      if (!win || typeof h !== 'number' || !Number.isFinite(h)) return;
      height = Math.max(1, Math.ceil(h));
      place();
      if (height < HIDE_BELOW) {
        reset();
        win.hide();
      }
    }),
  );
  ipcMain.on(
    'overlay:animate',
    fromOverlay((direction: unknown, still: unknown) => {
      if (direction === 'in' || direction === 'out') animate(direction, still === true);
    }),
  );
  ipcMain.on(
    'overlay:interactive',
    fromOverlay((on: unknown) => win?.setIgnoreMouseEvents(on !== true, { forward: true })),
  );
  ipcMain.on(
    'overlay:open',
    fromOverlay((card: unknown) => {
      if (card && typeof card === 'object') opts.onOpen(card as NotificationCard);
    }),
  );
  ipcMain.on(
    'overlay:jump',
    fromOverlay((card: unknown) => {
      if (card && typeof card === 'object') opts.onJump(card as NotificationCard);
    }),
  );
}

export { anchorIn, init, show };
export type { CardPrefs };
