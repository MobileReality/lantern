import { serverView } from '../lib/editorload';
import type { ServerInfo } from '../state';
import { createLoadScreen } from './load-screen';

const TICK_MS = 1000;

export interface ServerLoad {
  update(show: boolean, info: ServerInfo): void;
}

export function mountServerLoad(host: HTMLElement, onRestarted: (info: ServerInfo) => void): ServerLoad {
  let waitStart: number | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let last: ServerInfo | null = null;
  const screen = createLoadScreen(restart);
  host.append(screen.el);

  async function restart() {
    screen.setBusy(true);
    try {
      const info = await window.ccmws.restartEditor();
      waitStart = Date.now();
      onRestarted(info);
    } catch {
      // The failure screen stays up with Retry enabled; main pushes fresh status anyway.
    } finally {
      screen.setBusy(false);
    }
  }

  function draw() {
    if (last && waitStart !== null) screen.render(serverView(last), Date.now() - waitStart);
  }

  function update(show: boolean, info: ServerInfo) {
    host.classList.toggle('hidden', !show);
    last = info;
    if (!show) {
      waitStart = null;
      if (ticker) clearInterval(ticker);
      ticker = null;
      return;
    }
    waitStart ??= Date.now();
    ticker ??= setInterval(draw, TICK_MS);
    draw();
  }

  return { update };
}
