import { activeProjectPath, app } from './state';
import { baseName, folderToPath, byId, currentPlatform, isMac } from './lib/util';
import { fixMicrophone, openSkills } from './features/skills';
import { openMemory } from './features/memory';
import { openExplain } from './features/explain';
import './features/agent-run';
import { closeModals } from './features/settings';
import { dismissPalette, mountPalette } from './command-palette/index';
import { disposeLantern, hideLantern, refreshMap, openLantern, showCompare, stepLanternFile, syncLantern, syncSessions, toggleProblems } from './features/lantern';
import { mountServerLoad } from './features/server-load';
import { mountProjectIdent } from './project-ident';
import { watchEditorTab } from './features/editor-tab';
import { beginSettingsLoad, replaceSettings, settingValue, settingsSnapshot } from './lib/settings-state';
import { IDLE_SWEEP_MS, idleTabKeys } from './lib/idle-tabs';
import { initProviders, syncProvider } from './features/provider-control';
import { openIntegrations } from './features/integrations';
import { openedProjects } from './lib/opened-projects';
import { bindProjectListKeys } from './lib/project-list-keys';
import { makeRow } from './lib/sidebar-row';
import { releaseProject, type ReleaseDeps, type ReleaseMode } from './lib/project-release';
import { registerCommand, runCommand } from './commands';
import { installTooltips } from './tooltip';
import { keyChips, resolveUserKeymap } from '../shared/commands/keymap';
import { isCommandId } from '../shared/commands';
import type { Tab } from './state';
import LANTERN_MARK from './assets/icons/lantern-mark.svg';

const STATES: Record<string, { emoji: string; label: string }> = {
  running: { emoji: '🟢', label: 'working' },
  done: { emoji: '✅', label: 'finished' },
  shell: { emoji: '✅', label: 'finished · task running' },
  permission: { emoji: '🟠', label: 'needs you' },
  idle: { emoji: '💬', label: 'waiting' },
  failed: { emoji: '🔴', label: 'failed' },
  stopped: { emoji: '⚪️', label: 'stopped' },
  unknown: { emoji: '❔', label: 'state unknown' },
  unavailable: { emoji: '⚪️', label: 'status unavailable' },
  open: { emoji: '🪟', label: '' },
  blank: { emoji: '➕', label: 'pick a folder…' },
};
const ATTENTION = new Set(['done', 'shell', 'permission', 'idle', 'failed', 'stopped']);
const STATUS_NOTE_MS = 15_000;

const sidebarEl = byId('projects')!;
const projectFilterEl = byId('project-filter') as HTMLInputElement;
const projectCountEl = byId('project-count')!;
const viewsEl = byId('views')!;
const statusEl = byId('status')!;
const emptyEl = byId('empty')!;
const projectIdent = mountProjectIdent();
const emptyHintEl = byId('empty-hint')!;
installTooltips({
  keysFor: (command) => {
    const keys = isCommandId(command) ? resolveUserKeymap(settingValue('keymap.bindings')).byCommand.get(command) : undefined;
    return keys ? keyChips(keys, currentPlatform()) : undefined;
  },
});

const serverLoad = mountServerLoad(byId('loading'), (info) => {
  app.info = info;
  setStatus();
});

const { opened } = app;

const editorRequested = () => app.editorWanted || !!app.info.phase;

function lanternInFront() {
  const project = activeProjectPath();
  return !!project && app.lanternFront.has(project);
}

function updateLoading() {
  const editorShown = app.editorWanted || (!!app.activeKey && opened.has(app.activeKey));
  serverLoad.update(app.info.available && !app.info.ready && editorShown && !lanternInFront(), app.info);
}

window.addEventListener('mr:lantern-front', () => {
  if (lanternInFront()) {
    app.editorWanted = false;
    app.pending = null;
  }
  setStatus();
});

function showStatus(text: string, ready: boolean) {
  statusEl.textContent = text;
  statusEl.dataset.tip = text;
  statusEl.className = ready ? 'status ready' : 'status';
}

function markDevBuild(instance: Awaited<ReturnType<typeof window.ccmws.devInstance>>) {
  const banner = document.getElementById('dev-banner');
  if (!instance || !banner) return;
  const branch = instance.branch && instance.branch !== instance.name ? ` · ${instance.branch}` : '';
  document.documentElement.style.setProperty('--dev-color', `hsl(${instance.hue} 65% 42%)`);
  document.body.classList.add('dev-build');
  banner.textContent = `Dev build · ${instance.name}${branch} · ${instance.worktree}`;
  banner.hidden = false;
  document.title = `Lantern — dev: ${instance.name}`;
}

function setStatus() {
  if (!app.info.available) {
    showStatus('VS Code CLI not found', false);
    emptyHintEl.textContent = 'Couldn’t find the VS Code `code` command — install it or open VS Code once.';
  } else if (app.info.ready) {
    showStatus('VS Code server ready', true);
    emptyHintEl.textContent = '';
  } else if (editorRequested()) {
    showStatus(app.info.progress || 'Starting VS Code server…', false);
    emptyHintEl.textContent = '';
  } else {
    showStatus('', false);
    emptyHintEl.textContent = '';
  }
  if (statusNote) showStatus(statusNote, app.info.ready);
  statusEl.classList.toggle('note', statusNote !== null);
  statusEl.hidden = app.info.available && (app.info.ready || !editorRequested()) && statusNote === null;
  updateLoading();
}

// The server pushes its info every few seconds, which would repaint the status line at once.
let statusNote: string | null = null;
let statusNoteTimer: ReturnType<typeof setTimeout> | undefined;

function announceStatus(text: string) {
  clearTimeout(statusNoteTimer);
  statusNote = text;
  statusNoteTimer = setTimeout(() => {
    statusNote = null;
    setStatus();
  }, STATUS_NOTE_MS);
  setStatus();
}

function projectStatus(g: { sessions: { state: string }[] }) {
  if (g.sessions.some((s) => s.state === 'running')) return 'running';
  if (g.sessions.some((s) => ATTENTION.has(s.state))) return 'attention';
  return 'none';
}

function projectPathLabels(paths: string[]) {
  const segments = paths.map((path) => path.split(/[\\/]+/).filter(Boolean));
  return segments.map((parts, index) => {
    let length = Math.min(2, parts.length);
    while (length < parts.length) {
      const suffix = parts.slice(-length).join('/');
      if (!segments.some((other, otherIndex) => otherIndex !== index && other.slice(-length).join('/') === suffix)) break;
      length += 1;
    }
    return parts.slice(-length).join('/');
  });
}

function renderSidebar() {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.projectFocus : undefined;
  sidebarEl.innerHTML = '';

  for (const [key, entry] of opened) {
    if (entry.path) continue; // blank tabs not yet tied to a folder
    sidebarEl.appendChild(makeRow({ key, name: entry.label || 'New window', badge: STATES.blank.emoji, sub: 'pick a folder…', active: key === app.activeKey, open: true, onClick: () => activate(key), onRemove: () => closeTab(key) }));
  }

  const query = projectFilterEl.value.trim().toLocaleLowerCase();
  const visibleGroups = app.groups.filter((group) => !query || `${group.name}\n${group.path}`.toLocaleLowerCase().includes(query));
  const pathLabels = projectPathLabels(visibleGroups.map((group) => group.path));
  projectCountEl.textContent = query ? `${visibleGroups.length} of ${app.groups.length} projects` : `${app.groups.length} project${app.groups.length === 1 ? '' : 's'}`;

  for (const [index, g] of visibleGroups.entries()) {
    sidebarEl.appendChild(
      makeRow({
        key: g.path,
        name: g.name,
        status: projectStatus(g),
        sub: pathLabels[index],
        active: g.path === app.activeKey,
        title: g.path,
        cls: 'project-row',
        open: opened.has(g.path),
        onClick: () => openPath(g.path, g.name),
        onFree: () => release(g, 'free'),
        onRemove: () => release(g, 'remove'),
      }),
    );
  }

  if (query && visibleGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'project-no-results';
    empty.textContent = 'No projects match. Clear the filter to see all projects.';
    sidebarEl.appendChild(empty);
  }

  if (focused) restoreFocus(focused);
  if (!document.body.classList.contains('project-window')) projectIdent.show(activeProjectPath());
}

// A row action can remove its own button (Free memory closes the tab, Remove drops the row),
// so focus falls back to the project's selection button, then to the filter.
function restoreFocus(focused: string) {
  const targets = [...sidebarEl.querySelectorAll<HTMLElement>('[data-project-focus]')];
  const withKey = (key: string) => targets.find((element) => element.dataset.projectFocus === key);
  const key = focused.slice(focused.indexOf(':') + 1);
  (withKey(focused) ?? withKey(`select:${key}`) ?? projectFilterEl).focus();
}

function revealActiveProject() {
  sidebarEl.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' });
}

function makeTab(key: string, url: string, label: string) {
  const webview: any = document.createElement('webview');
  webview.setAttribute('partition', 'persist:ccm');
  webview.setAttribute('allowpopups', '');
  webview.src = url;
  let tab: Tab | undefined;
  const watch = watchEditorTab(webview, {
    label: () => tab?.label ?? label,
    otherPhases: () => [...opened.values()].filter((t) => t !== tab).map((t) => t.watch.phase()),
    serverReady: () => app.info.ready,
  });
  const onNav = () => {
    let u: URL;
    try {
      u = new URL(webview.getURL());
    } catch {
      return;
    }
    const folder = u.searchParams.get('folder');
    if (folder) onTabFolder(key, folderToPath(folder));
  };
  webview.addEventListener('did-navigate', onNav);
  webview.addEventListener('did-navigate-in-page', onNav);
  viewsEl.append(webview, watch.cover);
  tab = { webview, watch, path: key.startsWith('blank:') ? null : key, label };
  opened.set(key, tab);
  emptyEl.classList.add('hidden');
  activate(key);
}

function openWithoutEditor(folder: string, name: string) {
  window.ccmws.opened(folder, name);
  app.activeKey = folder;
  emptyEl.classList.add('hidden');
  renderSidebar();
  revealActiveProject();
  syncProvider();
  openLantern();
}

function openEditor(folder: string, name: string | undefined, thenLantern: boolean) {
  if (!app.info.available) return setStatus();
  if (!app.info.ready) {
    if (opened.has(folder)) activate(folder);
    else app.pending = () => openEditor(folder, name, thenLantern);
    return setStatus();
  }
  window.ccmws.opened(folder, name || baseName(folder));
  if (opened.has(folder)) activate(folder);
  else makeEditorTab(folder, name);
  if (thenLantern) openLantern();
}

function makeEditorTab(folder: string, name?: string) {
  // serve-web's ?folder= needs forward slashes AND a leading slash to be read as
  // absolute. macOS paths already start with "/"; a Windows "C:/…" must become
  // "/C:/…" or VS Code treats it as a relative path and the explorer stays blank.
  let uriPath = folder.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(uriPath)) uriPath = `/${uriPath}`;
  makeTab(folder, `http://127.0.0.1:${app.info.port}/?tkn=${app.info.token}&folder=${encodeURIComponent(uriPath)}`, name || baseName(folder));
}

function openPath(folder: string, name?: string) {
  if (!app.info.available || (!app.info.ready && !opened.has(folder))) return openWithoutEditor(folder, name || baseName(folder));
  openEditor(folder, name, !opened.has(folder));
}

function showEditor() {
  if (!app.info.available) return setStatus();
  if (!app.info.ready) {
    const queued = app.pending;
    app.pending = () => {
      queued?.();
      showEditor();
    };
    app.editorWanted = true;
    void window.ccmws.needEditor();
    hideLantern();
    return setStatus();
  }
  hideLantern();
  const project = app.activeKey;
  if (project && !project.startsWith('blank:')) openEditor(project, baseName(project), false);
}

function openBlank() {
  if (!app.info.available) return setStatus();
  if (!app.info.ready) {
    app.pending = openBlank;
    app.editorWanted = true;
    void window.ccmws.needEditor();
    hideLantern();
    return setStatus();
  }
  makeTab(`blank:${++app.blankCounter}`, `http://127.0.0.1:${app.info.port}/?tkn=${app.info.token}`, 'New window');
}

function onTabFolder(key: string, folder: string) {
  const entry = opened.get(key);
  if (!entry || entry.path === folder) return;
  if (opened.has(folder) && folder !== key) {
    entry.webview.remove();
    entry.watch.dispose();
    opened.delete(key);
    activate(folder);
    return;
  }
  opened.delete(key);
  entry.path = folder;
  entry.label = baseName(folder);
  opened.set(folder, entry);
  if (app.activeKey === key) app.activeKey = folder;
  syncLantern();
  syncProvider();
  window.ccmws.opened(folder, baseName(folder));
  window.ccmws.addPath(folder).then((list: typeof app.groups) => {
    app.groups = list;
    renderSidebar();
  });
  renderSidebar();
}

function activate(key: string) {
  const now = Date.now();
  const leaving = app.activeKey ? opened.get(app.activeKey) : undefined;
  if (leaving) leaving.lastSelectedAt = now;
  const arriving = opened.get(key);
  if (arriving) arriving.lastSelectedAt = now;
  app.activeKey = key;
  for (const [k, { webview, watch }] of opened) {
    const on = k === key;
    webview.classList.toggle('active', on);
    watch.cover.style.display = on ? '' : 'none';
  }
  renderSidebar();
  revealActiveProject();
  syncLantern();
  syncProvider();
}

function closeTab(key: string) {
  const entry = opened.get(key);
  if (!entry) return;
  entry.webview.remove();
  entry.watch.dispose();
  opened.delete(key);
  disposeLantern(key);
  if (app.activeKey === key) {
    app.activeKey = [...opened.keys()][0] || null;
    if (app.activeKey) activate(app.activeKey);
    else emptyEl.classList.remove('hidden');
  }
  renderSidebar();
  syncLantern();
  syncProvider();
}

function sessionsOfProject(path: string) {
  return app.groups.find((group) => group.path === path)?.sessions;
}

// Closing a tab only frees memory when the server was started with the short reconnection
// grace time (info.graceSeconds); against a server that waits hours, it would only lose edits.
function closeIdleTabs() {
  if (!settingValue('tabs.closeIdleProjectTabs') || !app.info.graceSeconds) return;
  const candidates = [...opened].map(([key, tab]) => ({ key, path: tab.path, lastSelectedAt: tab.lastSelectedAt }));
  const rule = { activeKey: app.activeKey, now: Date.now(), idleMinutes: settingValue('tabs.idleMinutes'), sessionsOf: sessionsOfProject };
  for (const key of idleTabKeys(candidates, rule)) {
    console.info(`[tabs] closing idle project tab ${key}`);
    closeTab(key);
  }
}

const releaseDeps: ReleaseDeps = {
  isOpen: (path) => opened.has(path),
  sessionsOf: sessionsOfProject,
  confirm: (message) => window.confirm(message),
  closeTab,
  freeMemory: (path) => window.ccmws.freeProjectMemory(path),
  hide: async (path) => {
    app.groups = await window.ccmws.hide(path);
    renderSidebar();
  },
  announce: announceStatus,
};

function release(group: { path: string; name: string }, mode: ReleaseMode) {
  void releaseProject({ path: group.path, name: group.name, mode }, releaseDeps);
}

const modeBtn = byId('mode-btn')!;
byId('mode-mark').innerHTML = LANTERN_MARK;

projectFilterEl.addEventListener('input', renderSidebar);
bindProjectListKeys(projectFilterEl, sidebarEl, renderSidebar);

async function addFolder() {
  const { groups, selectedPath } = await window.ccmws.addFolder();
  app.groups = groups;
  renderSidebar();
  if (selectedPath) openPath(selectedPath, groups.find((group) => group.path === selectedPath)?.name);
}

const BUTTON_COMMANDS = [
  ['command-palette-btn', 'palette.open'],
  ['new', 'project.new'],
  ['addFolder', 'project.addFolder'],
  ['mic-btn', 'skills.fixMicrophone'],
] as const;
for (const [buttonId, commandId] of BUTTON_COMMANDS) byId(buttonId)!.addEventListener('click', () => runCommand(commandId));
modeBtn.addEventListener('click', () => runCommand(modeBtn.getAttribute('aria-checked') === 'true' ? 'editor.show' : 'lantern.open'));

window.ccmws.onProjects((list: typeof app.groups) => {
  app.groups = list;
  renderSidebar();
  syncSessions();
});
window.ccmws.onSettingsChanged(({ snapshot, changed }) => replaceSettings(snapshot, changed));
window.ccmws.onCommand((id) => {
  if (id !== 'palette.open') dismissPalette();
  runCommand(id);
});
function runPending() {
  if (!app.info.ready || !app.pending) return;
  const fn = app.pending;
  app.pending = null;
  fn();
}

window.ccmws.onInfo((i: typeof app.info) => {
  app.info = i;
  setStatus();
  runPending();
});
window.ccmws.onOpen((cwd: string, project: string) => {
  if (cwd) openPath(cwd, project || baseName(cwd));
});
window.ccmws.onShowCompare((project: string, id: string) => {
  void showCompare(project, id);
});

// A pop-out window loads this same page in "popout" mode: it shows just one tool,
// full-window, for the given project — no sidebar, no editor, no other chrome.
function initPopout(tool: string, project: string) {
  document.body.classList.add('popout');
  app.activeKey = project || null;
  if (tool === 'explain') openExplain();
}

// Without the VS Code CLI openPath bails out early; a project window has no sidebar
// to pick the project from, so it must claim its project regardless.
function openProjectRoot(root: string) {
  app.activeKey = root;
  syncProvider();
  openPath(root, baseName(root));
}

const popoutParams = new URLSearchParams(location.search);
const popoutTool = popoutParams.get('popout');
const projectRoot = popoutParams.get('project');
if (popoutTool) {
  window.ccmws.settingsGet().then((s) => {
    initPopout(popoutTool, projectRoot || '');
    initProviders(s.providers, projectRoot);
  });
} else {
  document.body.classList.toggle('mac', isMac());
  if (projectRoot) {
    document.body.classList.add('project-window');
    projectIdent.show(projectRoot);
  }
  setInterval(closeIdleTabs, IDLE_SWEEP_MS);
  const palette = mountPalette();
  registerCommand('editor.devtools', () => {
    const entry = app.activeKey ? opened.get(app.activeKey) : null;
    if (entry && entry.webview.openDevTools) entry.webview.openDevTools();
  });
  registerCommand('project.new', openBlank);
  registerCommand('project.addFolder', () => void addFolder());
  if (!projectRoot) registerCommand('project.filter', () => projectFilterEl.focus());
  registerCommand('editor.restart', () => {
    if (app.activeKey) void window.ccmws.restartEditor();
  });
  registerCommand('lantern.open', openLantern);
  registerCommand('lantern.problems', toggleProblems);
  registerCommand('lantern.previousFile', () => stepLanternFile(-1));
  registerCommand('lantern.nextFile', () => stepLanternFile(1));
  registerCommand('editor.show', showEditor);
  registerCommand('lantern.refresh', () => refreshMap());
  registerCommand('explain.open', () => closeModals() && void openExplain());
  registerCommand('memory.open', () => closeModals() && void openMemory());
  registerCommand('skills.open', () => closeModals() && void openSkills());
  registerCommand('integrations.open', () => closeModals() && openIntegrations(document.activeElement, { projects: openedProjects }));
  registerCommand('skills.fixMicrophone', () => void fixMicrophone());
  void window.ccmws.devInstance().then(markDevBuild);
  (async () => {
    const adoptStartupSnapshot = beginSettingsLoad();
    const [info, groups, settings, userSettings] = await Promise.all([
      window.ccmws.info(),
      window.ccmws.projects(),
      window.ccmws.settingsGet(),
      window.ccmws.settingsSnapshot().catch(() => settingsSnapshot()),
    ]);
    adoptStartupSnapshot(userSettings);
    palette.renderFieldKeys();
    app.info = info;
    app.groups = groups;
    initProviders(settings.providers, projectRoot);
    app.dismissedPrs = new Map(Object.entries(settings.dismissedPrs ?? {}));
    setStatus();
    renderSidebar();
    syncLantern();
    syncProvider();
    runPending();
    if (projectRoot) openProjectRoot(projectRoot);
    const compare = popoutParams.get('compare');
    if (projectRoot && compare) void showCompare(projectRoot, compare);
  })();
}
