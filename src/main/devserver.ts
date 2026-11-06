// Dev-only visual harness: lets the developer (or an agent) screenshot and drive the
// renderer to verify UI changes. Started ONLY when CCM_DEBUG is set — never in a
// normal build — bound to loopback, and every request needs the per-launch token.

import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { BrowserWindow } from 'electron';
import { DEV_PROFILE, PORT } from '../shared/config';
import { newDebugToken, refusalFor, REFUSAL } from './devserver-guard';

const DEV_PORT = DEV_PROFILE ? 0 : PORT + 2;

function requestAnimationFrameIn(win: BrowserWindow, cb: () => void) {
  win.webContents
    .executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))) ', true)
    .then(cb)
    .catch(cb);
}

// Resolve the target window: an explicit ?win=<id>, else the main workspace window.
function pickWindow(url: URL, getMain: () => BrowserWindow | null): BrowserWindow | null {
  const id = url.searchParams.get('win');
  if (id) return BrowserWindow.getAllWindows().find((w) => String(w.id) === id) || null;
  return getMain();
}

function parseUrl(raw: string | undefined) {
  try {
    return new URL(raw || '/', 'http://127.0.0.1');
  } catch {
    return null;
  }
}

function start(getMain: () => BrowserWindow | null, openMain: () => void, notify: (kind: string) => boolean, toggleTray: () => void, port = DEV_PORT) {
  const token = newDebugToken();
  const server = http.createServer(async (req, res) => {
    const url = parseUrl(req.url);
    const bound = (server.address() as AddressInfo | null)?.port ?? 0;
    const refusal = url ? refusalFor({ method: req.method, headers: req.headers, url, port: bound, token }) : REFUSAL.FORBIDDEN;
    if (refusal !== null || !url) {
      res.writeHead(refusal ?? REFUSAL.FORBIDDEN).end();
      return;
    }

    if (url.pathname === '/windows') {
      const list = BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), bounds: w.getBounds(), visible: w.isVisible() }));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list));
      return;
    }

    if (url.pathname === '/notify') {
      const shown = notify(url.searchParams.get('kind') || 'done');
      res.writeHead(shown ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: shown }));
      return;
    }

    if (url.pathname === '/tray') {
      toggleTray();
      res.writeHead(200).end('ok');
      return;
    }

    let win = pickWindow(url, getMain);
    if ((!win || win.isDestroyed()) && !url.searchParams.get('win')) {
      openMain();
      await new Promise((r) => setTimeout(r, 2500));
      win = getMain();
    }
    if (!win || win.isDestroyed()) {
      res.writeHead(503).end('no such window');
      return;
    }

    if (url.pathname === '/shot') {
      const file = url.searchParams.get('path') || '/tmp/ccm-shot.png';
      try {
        win.show();
        win.moveTop();
        win.focus();
        win.webContents.invalidate();
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          win.webContents.once('paint', finish);
          requestAnimationFrameIn(win, finish);
          setTimeout(finish, 1500);
        });
        const image = await win.webContents.capturePage();
        fs.writeFileSync(file, image.toPNG());
        res.writeHead(200).end(file);
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
      return;
    }

    if (url.pathname === '/eval') {
      const code = url.searchParams.get('js') || '';
      try {
        const out = await win.webContents.executeJavaScript(code, true);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, out }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    res.writeHead(404).end();
  });

  server.on('error', (err: NodeJS.ErrnoException) => console.log(`CCM_DEBUG harness did not start: ${err.code || err.message}`));
  server.listen(port, '127.0.0.1');
  return { server, token };
}

export { start };
