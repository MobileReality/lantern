import {
  PAGE_PROBE_SCRIPT,
  initialTabLoad,
  navigatedTabLoad,
  observePage,
  shouldRestartServer,
  tabView,
  tickTabLoad,
  toPageKind,
  type PageKind,
  type TabLoad,
  type TabPhase,
} from '../lib/editorload';
import type { EditorWatch } from '../state';
import { createLoadScreen } from './load-screen';

const PROBE_INTERVAL_MS = 1000;
const RELOAD_AFTER_FAIL_MS = 2000;
const ERR_ABORTED = -3;

interface WatchOpts {
  label(): string;
  otherPhases(): TabPhase[];
  serverReady(): boolean;
}

// serve-web's interim pages are unstyled (black text on the dark webview), so the
// cover stays up until the workbench itself is in the page, not just until load stops.
export function watchEditorTab(webview: any, opts: WatchOpts): EditorWatch {
  let load: TabLoad = initialTabLoad(Date.now());
  let waitStart = load.since;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  const screen = createLoadScreen(retry);

  function render() {
    const hidden = load.phase === 'ready';
    screen.el.classList.toggle('hidden', hidden);
    if (!hidden) screen.render(tabView(load, opts.label()), Date.now() - waitStart);
  }

  function update(next: TabLoad) {
    load = next;
    render();
  }

  function restartWatch() {
    load = initialTabLoad(Date.now());
    waitStart = load.since;
    render();
  }

  async function probe() {
    const now = Date.now();
    if (load.phase === 'ready' || load.phase === 'failed') return;
    // The server-level screen covers this wait; the tab's clock starts once it's up.
    if (!opts.serverReady()) return update({ ...load, since: now });
    let kind: PageKind = 'blank';
    try {
      kind = toPageKind(await webview.executeJavaScript(PAGE_PROBE_SCRIPT));
    } catch {}
    update(tickTabLoad(observePage(load, kind, Date.now()), Date.now()));
  }

  async function retry() {
    screen.setBusy(true);
    try {
      if (shouldRestartServer(opts.otherPhases())) await window.ccmws.restartEditor();
    } catch {
      // A reload still follows; if the server is really gone the tab times out again.
    } finally {
      screen.setBusy(false);
    }
    restartWatch();
    webview.reload();
  }

  const timer = setInterval(probe, PROBE_INTERVAL_MS);
  webview.addEventListener('dom-ready', probe);
  webview.addEventListener('did-navigate', () => {
    const next = navigatedTabLoad(load, Date.now());
    if (next !== load) restartWatch();
  });
  webview.addEventListener('did-fail-load', (e: { errorCode: number; isMainFrame: boolean }) => {
    if (!e.isMainFrame || e.errorCode === ERR_ABORTED || load.phase === 'failed') return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (load.phase !== 'failed') webview.reload();
    }, RELOAD_AFTER_FAIL_MS);
  });
  render();

  return {
    cover: screen.el,
    phase: () => load.phase,
    dispose() {
      clearInterval(timer);
      if (reloadTimer) clearTimeout(reloadTimer);
      screen.el.remove();
    },
  };
}
