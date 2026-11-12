// Opens a tool in its own OS window, independent of the main
// app window. It reuses the same renderer (workspace.html) in a "popout" mode, so
// there's one codebase for the in-app modal and the detached window.

import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';

const BG = '#040d23';
const TOOLS: Record<string, { title: string; w: number; h: number }> = {
  explain: { title: 'Explain', w: 1100, h: 820 },
};

interface Options {
  windowIcon?: string;
  preload: string;
  htmlDir: string;
  onCreated: (wc: WebContents) => void;
  onClosed: (wc: WebContents) => void;
}

let opts: Options | null = null;
const windows = new Map<BrowserWindow, { tool: string; opener: WebContents | null }>();

function init(o: Options) {
  opts = o;
}

function open(tool: string, project: string, opener: WebContents | null = null) {
  const def = opts && project ? TOOLS[tool] : null;
  if (!opts || !def) return;
  const win = new BrowserWindow({
    width: def.w,
    height: def.h,
    minWidth: 520,
    minHeight: 420,
    title: `${def.title} — ${path.basename(project)}`,
    backgroundColor: BG,
    ...(opts.windowIcon ? { icon: opts.windowIcon } : {}),
    show: false,
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windows.set(win, { tool, opener });
  const wc = win.webContents;
  opts.onCreated(wc);
  win.on('page-title-updated', (e) => e.preventDefault()); // keep our "<tool> — <project>" title
  if (process.env.CCM_DEBUG) {
    wc.on('did-fail-load', (_e, code, desc) => console.log('[popout] did-fail-load', code, desc));
    wc.on('render-process-gone', (_e, d) => console.log('[popout] render-process-gone', JSON.stringify(d)));
    wc.on('console-message', ({ level, message, sourceId, lineNumber }) => console.log(`[popout:${level}] ${message} (${sourceId}:${lineNumber})`));
    win.on('close', () => console.log('[popout] close event'));
  }
  win.loadFile(path.join(opts.htmlDir, 'workspace.html'), { query: { popout: tool, project } });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    windows.delete(win);
    opts?.onClosed(wc);
  });
}

function hasOpen() {
  return windows.size > 0;
}

function isPopout(wc: WebContents) {
  return [...windows.keys()].some((win) => !win.isDestroyed() && win.webContents === wc);
}

function closeOpenedBy(opener: WebContents) {
  for (const [win, entry] of windows) {
    if (entry.opener === opener && !win.isDestroyed()) win.close();
  }
}

export { init, open, hasOpen, isPopout, closeOpenedBy };
