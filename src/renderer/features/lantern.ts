import { app, activeProjectPath } from '../state';
import { assistantName, providerForProject, providerLabel } from '../lib/providers';
import { baseName, byId } from '../lib/util';
import type { LanternCoverage, LanternMap } from '../../main/lantern';
import { isMissing } from '../lib/lanternlayout';
import { renderSessions, renderStats } from '../lantern-status';
import { mountProblems } from '../lantern-problems';
import type { Problem, ProblemList } from '../lantern-problems';
import { openCodeModal } from '../lib/codemodal';
import { syncLang } from '../lib/lanternhead';
import { brokenPlanFix, createPlanFix } from '../lib/lanternplanfix';
import type { FixRunner, PlanFix } from '../lib/lanternplanfix';
import { openCompareModal } from '../lib/comparemodal';
import { mountLanternView } from '../lib/lanternview';
import { syncPlanWindow } from '../lib/lanternplanwindow';
import { projectExplainClient } from '../lib/prexplain-client';
import { isNoOrigin, shortError } from '../lib/lanternprs';
import type { FetchResult } from '../lib/lanternprs';
import type { LanternView } from '../lib/lanternview';
import { SetupRun } from '../lib/setuprun';
import { mountSetupScreen } from '../lib/setupscreen';
import { resumeLabel } from '../lib/setupprogress';
import type { SetupKind } from '../lib/setupprogress';
import type { SetupProgress } from '../../main/setup-progress';
import { cancelRun, fixPlanFile, isBusy, startRun } from './agent-run';
import { openIntegrations } from './integrations';
import { mountProviderButton } from './provider-control';
import { openedProjects } from '@renderer/lib/opened-projects';
import { mountIntegrationChip } from '@renderer/lib/integrations-chip';
import type { IntegrationChip } from '@renderer/lib/integrations-chip';
import { affectsSetting } from '../../shared/settings-registry';
import { onSettingsChanged, settingValue } from '../lib/settings-state';

interface Panel {
  el: HTMLElement;
  head: HTMLElement;
  stats: HTMLElement;
  sessions: HTMLElement;
  refocusReload: boolean;
  noteEl: HTMLElement;
  body: HTMLElement;
  problems: ProblemList;
  fetchError: string | null;
  runError: string | null;
  dismissed: Set<string>;
  actions: HTMLElement;
  view: LanternView | null;
  data: LanternMap | null;
  run: SetupRun;
  screen: { destroy(): void } | null;
  offer: ResumeOffer | null;
  timer: ReturnType<typeof setInterval> | null;
  lastPhase: string;
  loadToken: number;
  langEl: HTMLSelectElement | null;
  stamp: string | null;
  loadedAt: number;
  integrations: IntegrationChip;
  planFix: PlanFix;
  disposeProvider: () => void;
}

interface ResumeOffer {
  kind: SetupKind;
  progress: SetupProgress | null;
}

const RUN_TICK_MS = 1000;

const hostEl = byId('lantern-tab');
const panels = new Map<string, Panel>();
const closedWhileRunning = new Set<string>();
const FETCH_INTERVAL_MS = 5 * 60 * 1000;
const FULL_RELOAD_MS = 5 * 60 * 1000;
const lastFetch = new Map<string, number>();
const fetching = new Map<string, Promise<FetchResult>>();
const forcedFetches = new Set<string>();

const planFixRunner: FixRunner = {
  busy: isBusy,
  start(file, handlers) {
    fixPlanFile(file, {
      begin: () => undefined,
      line: () => undefined,
      done(ok, meta) {
        handlers.done(ok, meta.denials);
        window.dispatchEvent(new Event('mr:files-changed'));
      },
      fail: handlers.fail,
      cancelled: handlers.cancelled,
    }).catch((e) => handlers.fail(e instanceof Error ? e.message : String(e)));
  },
  cancel: () => void cancelRun(),
};

function makePanel(project: string): Panel {
  const el = document.createElement('div');
  el.className = 'lt-panel hidden';
  const head = document.createElement('div');
  head.className = 'lt-head';
  const note = document.createElement('span');
  note.className = 'lt-note';
  const actions = document.createElement('div');
  actions.className = 'lt-actions';
  const integrations = mountIntegrationChip(project, (opener) => openIntegrations(opener, { projects: openedProjects, focusProject: project }));
  head.append(note, actions);
  const body = document.createElement('div');
  body.className = 'lt-body';
  const bar = document.createElement('div');
  bar.className = 'lt-statusbar';
  const stats = document.createElement('div');
  stats.className = 'lt-stats';
  const providerHost = document.createElement('div');
  const sessions = document.createElement('span');
  sessions.setAttribute('role', 'status');
  const problemsHost = document.createElement('div');
  bar.append(problemsHost, sessions, stats, integrations.el, providerHost);
  const disposeProvider = mountProviderButton(providerHost);
  el.append(head, body, bar);
  hostEl.appendChild(el);
  const run = new SetupRun({
    project,
    assistant: () => assistantName(project),
    startRun: (kind, handlers) => startRun(kind, handlers),
    cancelRun,
    readProgress: async (mode) => (await window.ccmws.lanternProgress(project, mode)).progress,
    now: Date.now,
  });
  const planFix = createPlanFix({ copy: (text) => navigator.clipboard.writeText(text), runner: planFixRunner });
  const panel: Panel = { el, head, stats, sessions, refocusReload: false, noteEl: note, problems: mountProblems(problemsHost, (where) => openCodeModal(el, (file) => window.ccmws.projectReadFile(project, file), where.file, '', undefined, undefined, (file, source) => window.ccmws.semanticHighlight({ project, path: file, source }), false, where.line)), fetchError: null, runError: null, dismissed: new Set(), body, actions, view: null, data: null, run, screen: null, offer: null, timer: null, lastPhase: 'idle', loadToken: 0, langEl: null, stamp: null, loadedAt: 0, integrations, planFix, disposeProvider };
  planFix.onChange(() => syncProblems(project, panel));
  run.subscribe(() => onRunChange(project, panel));
  renderSessions(panel.sessions, sessionsOf(project), assistantName(project));
  return panel;
}

function panelFor(project: string) {
  let p = panels.get(project);
  if (!p) {
    p = makePanel(project);
    panels.set(project, p);
  }
  return p;
}

function button(text: string, cls: string, onClick: () => void, disabled = false) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderActions(project: string, panel: Panel) {
  const onReload = document.activeElement instanceof HTMLElement && panel.actions.contains(document.activeElement) && document.activeElement.matches('.lt-icon');
  panel.refocusReload = onReload || (panel.refocusReload && (!document.activeElement || document.activeElement === document.body));
  panel.actions.textContent = '';
  if (screenUp(panel)) return;
  const exists = !!panel.data?.exists;
  const busy = isBusy();
  const assistant = assistantName(project);
  const label = exists ? '✦ Refresh map' : '✦ Set up Lantern map';
  const needsRefresh = exists && needsRefreshing(panel.data) && !panel.offer;
  const btn = button(label, `lt-btn lt-primary${needsRefresh ? ' lt-attention' : ''}`, () => run(project, panel, exists ? 'lantern-refresh' : 'lantern'), busy);
  if (exists) btn.dataset.tipCommand = 'lantern.refresh';
  if (busy) btn.dataset.tip = `Another ${assistant} run is in progress`;
  const checking = fetching.has(project);
  const reload = button('⟳', 'lt-btn lt-icon', () => void reloadWithFetch(project), checking);
  reload.dataset.tip = 'Check the remote for new pull requests and reload the map';
  reload.setAttribute('aria-label', 'Reload the map');
  if (checking) reload.setAttribute('aria-busy', 'true');
  if (!busy) btn.dataset.tip = `${assistant} refreshes the map texts of files that changed`;
  panel.actions.append(btn, reload);
  if (panel.refocusReload && !reload.disabled) {
    reload.focus();
    panel.refocusReload = false;
  }
}

function screenUp(panel: Panel) {
  return panel.run.state.phase !== 'idle';
}

function run(project: string, panel: Panel, kind: SetupKind, resumed = false) {
  if (isBusy() || panel.run.isActive()) return;
  void panel.run.start(kind, resumed, resumed ? (panel.offer?.progress ?? null) : null);
}

function stoppedNote(panel: Panel) {
  const progress = panel.run.state.progress;
  return progress ? `Stopped — ${progress.files.done} of ${progress.files.total} files mapped` : 'Stopped';
}

function onRunChange(project: string, panel: Panel) {
  if (closedWhileRunning.has(project) && !panel.run.isActive()) return disposeLantern(project);
  const { phase, kind, summary } = panel.run.state;
  const previous = panel.lastPhase;
  const changed = phase !== previous;
  if (phase === 'running' && !panel.timer) panel.timer = setInterval(() => void panel.run.tick(), RUN_TICK_MS);
  if (phase !== 'running' && panel.timer) {
    clearInterval(panel.timer);
    panel.timer = null;
  }
  if (phase === 'stopped') panel.noteEl.textContent = stoppedNote(panel);
  if (!changed) return;
  panel.lastPhase = phase;
  if (phase === 'running') panel.noteEl.textContent = kind === 'lantern' ? 'Building the map — you can stop and resume it later.' : 'Refreshing the map — you can stop and resume it later.';
  else if (phase === 'failed') panel.noteEl.textContent = 'Stopped early';
  if (phase === 'running') panel.runError = null;
  if (phase === 'failed') panel.runError = `${kind === 'lantern' ? 'Map setup' : 'Map refresh'} stopped: ${panel.run.state.error ?? 'the run did not finish'}`;
  if (phase === 'done') {
    panel.noteEl.textContent = `Done · ${summary}`;
    window.dispatchEvent(new Event('mr:files-changed'));
    void Promise.all([load(project, true), panel.run.settled()]).then(() => {
      panel.offer = offerAfterRun(panel);
      panel.run.dismiss();
    });
  }
  if (phase === 'idle') {
    panel.screen?.destroy();
    panel.screen = null;
    if (previous !== 'done') void loadOffer(project, panel);
  }
  renderActions(project, panel);
  renderBody(project, panel);
  syncProblems(project, panel);
}

function offerAfterRun(panel: Panel): ResumeOffer | null {
  const { kind, progress } = panel.run.state;
  return kind && progress && progress.chunks.done < progress.chunks.total ? { kind, progress } : null;
}

async function loadOffer(project: string, panel: Panel) {
  let state: Awaited<ReturnType<Window['ccmws']['lanternProgress']>> | null = null;
  try {
    state = await window.ccmws.lanternProgress(project);
  } catch {}
  if (screenUp(panel)) return;
  panel.offer = state?.unfinished ? { kind: state.unfinished, progress: state.progress } : null;
  renderActions(project, panel);
  if (panel.data?.exists) syncProblems(project, panel);
  else renderBody(project, panel);
}

function emptyState(project: string, panel: Panel) {
  const box = document.createElement('div');
  box.className = 'lt-empty';
  const inner = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = 'No Lantern map yet';
  const p = document.createElement('p');
  p.textContent = 'Lantern maps every source file by role, purpose and relations, so you can see how the project fits together without reading the code.';
  const hint = document.createElement('p');
  hint.className = 'hint';
  const provider = providerForProject(project);
  const assistant = providerLabel(provider);
  const skillsDir = provider === 'codex' ? '.agents/' : '.claude/';
  hint.textContent = `${assistant} writes the map into ${project}/.lantern/, and adds the Lantern skill to ${skillsDir} if the project has none.`;
  const setup = document.createElement('div');
  setup.className = 'lt-setup';
  const offer = panel.offer;
  const label = offer ? resumeLabel(offer.progress, offer.kind) : '✦ Set up Lantern map';
  setup.append(button(label, 'lt-btn lt-primary', () => (offer ? run(project, panel, offer.kind, true) : run(project, panel, 'lantern')), isBusy()));
  inner.append(h, p, setup, hint);
  box.appendChild(inner);
  return box;
}

function renderBody(project: string, panel: Panel) {
  const data = panel.data;
  if (screenUp(panel)) {
    if (!panel.screen) {
      detachStrip(panel);
      panel.view?.dispose();
      panel.view = null;
      panel.body.textContent = '';
      panel.screen = mountSetupScreen(panel.body, { project, run: panel.run, isBusy, onView: () => panel.run.dismiss() });
    }
    return;
  }
  if (!data) {
    panel.body.textContent = 'Loading…';
    return;
  }
  if (!data.exists) {
    detachStrip(panel);
    panel.view?.dispose();
    panel.view = null;
    panel.body.textContent = '';
    panel.body.appendChild(emptyState(project, panel));
    return;
  }
  if (!panel.view || !panel.body.querySelector('.lt-root')) {
    detachStrip(panel);
    panel.view?.dispose();
    panel.body.textContent = '';
    const root = document.createElement('div');
    panel.body.appendChild(root);
    panel.view = mountLanternView(root, data, {
      project,
      foldFiles: settingValue('graph.foldFilesWhenZoomedOut'),
      planFix: panel.planFix,
      platform: app.lanternPlatform.get(project),
      onPlatform: (id) => app.lanternPlatform.set(project, id),
      section: app.lanternSection.get(project),
      onSection: (id) => app.lanternSection.set(project, id),
      readFile: (file) => window.ccmws.projectReadFile(project, file),
      readSemantic: (file, source) => window.ccmws.semanticHighlight({ project, path: file, source }),
      readPrFile: (pr, file) => window.ccmws.lanternPrFile(project, pr, file),
      readPrDiff: (pr, file, sides) => window.ccmws.lanternPrFileDiff(project, pr, file, sides),
      readPrOverlay: (pr, lang) => window.ccmws.lanternPrOverlay(project, pr, lang),
      readMacro: () => window.ccmws.lanternMacro(project, app.lanternLang.get(project)),
      explain: projectExplainClient(project),
      explainCollapsed: app.explainCollapsed.get(project),
      onExplainCollapsed: (collapsed) => app.explainCollapsed.set(project, collapsed),
      pr: app.lanternPr.get(project),
      onPr: (id) => app.lanternPr.set(project, id),
      dismissedPrs: app.dismissedPrs.get(project) ?? [],
      onDismissPr: (id) => {
        app.dismissedPrs.set(project, [...(app.dismissedPrs.get(project) ?? []), id]);
        void window.ccmws.settingsDismissPr(project, id);
      },
      onRestorePrs: () => {
        app.dismissedPrs.delete(project);
        void window.ccmws.settingsRestorePrs(project);
      },
      onCompare: (select) =>
        openCompareModal({
          project,
          api: {
            refs: () => window.ccmws.lanternCompareRefs(project),
            commits: (ref) => window.ccmws.lanternCompareCommits(project, ref),
            stat: (base, head) => window.ccmws.lanternCompareStat(project, base, head),
          },
          onPick: async (id) => {
            await window.ccmws.settingsAddLocalReview(project, id);
            await load(project);
            select(id);
          },
        }),
      onRemoveLocal: async (id) => {
        await window.ccmws.settingsRemoveLocalReview(project, id);
        await load(project);
      },
      onGenerateReasons: async (id) => {
        const result = await window.ccmws.lanternLocalReasons(project, id);
        if (result.ok) await load(project);
        return result;
      },
      onRefreshPrs: async () => {
        const result = await window.ccmws.lanternRefreshPrs(project);
        await load(project, true);
        return result;
      },
      onEnterPr: (id) => {
        void Promise.resolve()
          .then(() => window.ccmws.lanternEnterPr(project, id))
          .then((res) => (res.changed ? load(project) : undefined), () => undefined);
      },
      onMapMissing: () => {
        const panel = panelFor(project);
        run(project, panel, panel.data?.exists ? 'lantern-refresh' : 'lantern');
      },
    });
  } else {
    panel.view.update(data);
  }
  const strip = panel.body.querySelector('.lt-prs');
  if (strip) panel.head.prepend(strip);
}

function detachStrip(panel: Panel) {
  panel.head.querySelector('.lt-prs')?.remove();
}

function syncProblems(project: string, panel: Panel) {
  const data = panel.data;
  const items: Problem[] = [];
  if (data?.exists) {
    data.errors.forEach((error, i) => { items.push({ id: `map:${i}`, severity: 'error', message: messageOf(error), location: locationOf(error) }); });
    for (const warning of new Set(data.warnings)) {
      if (panel.dismissed.has(warning)) continue;
      const broken = data.brokenPlans.find((each) => each.warning === warning);
      const fix = broken ? brokenPlanFix(panel.planFix, broken) : null;
      items.push({ id: `warn:${warning}`, severity: 'warning', message: fix?.status ? `${messageOf(warning)} ${fix.status}` : messageOf(warning), location: locationOf(warning), actions: [...(fix?.actions ?? []), { label: 'Dismiss', run: () => {
        panel.dismissed.add(warning);
        syncProblems(project, panel);
      } }] });
    }
  }
  if (panel.runError) {
    items.push({ id: 'run:failed', severity: 'error', toast: true, message: panel.runError, actions: [{ label: 'Dismiss', run: () => {
      panel.runError = null;
      syncProblems(project, panel);
    } }] });
  }
  if (panel.fetchError) {
    items.push({ id: 'prs:fetch', severity: 'error', message: panel.fetchError, actions: [{ label: 'Dismiss', run: () => {
      panel.fetchError = null;
      syncProblems(project, panel);
    } }] });
  }
  const offer = panel.offer;
  if (offer && !screenUp(panel) && data?.exists) {
    const what = offer.kind === 'lantern' ? 'Setup is unfinished' : 'The refresh is unfinished';
    items.push({ id: 'run:unfinished', severity: 'notice', message: `${what}. Everything mapped so far is kept; Resume continues with what is left.`, actions: [{ label: resumeLabel(offer.progress, offer.kind), primary: true, disabled: isBusy(), run: () => run(project, panel, offer.kind, true) }] });
  }
  panel.problems.sync(items);
}

const FILE_LINE_PREFIX = /^(\S+?):(\d+): /;

function locationOf(text: string) {
  const m = FILE_LINE_PREFIX.exec(text);
  return m ? { file: m[1], line: Number(m[2]) } : undefined;
}

function messageOf(text: string) {
  return text.replace(FILE_LINE_PREFIX, '');
}

function sessionsOf(project: string) {
  return (app.groups ?? []).find((group) => group.path === project)?.sessions ?? [];
}

function toggleProblems() {
  const project = activeProjectPath();
  const panel = project ? panels.get(project) : undefined;
  if (panel && project && app.lanternFront.has(project)) panel.problems.toggle();
}

function syncSessions() {
  for (const [project, panel] of panels) renderSessions(panel.sessions, sessionsOf(project), assistantName(project));
}

const NO_COVERAGE: LanternCoverage = { unmapped: [], unmappedCount: 0, total: 0 };

function coverageOf(data: LanternMap | null): LanternCoverage | null {
  return data && !data.coveragePending ? { unmapped: data.unmapped, unmappedCount: data.unmappedCount, total: data.total } : null;
}

function sameCoverage(a: LanternCoverage | null, b: LanternCoverage) {
  return !!a && a.total === b.total && a.unmappedCount === b.unmappedCount && a.unmapped.join('\n') === b.unmapped.join('\n');
}

async function loadCoverage(project: string, panel: Panel, token: number, fresh: boolean) {
  let coverage: LanternCoverage;
  try {
    coverage = await (fresh ? window.ccmws.lanternCoverage(project, true) : window.ccmws.lanternCoverage(project));
  } catch {
    coverage = coverageOf(panel.data) ?? NO_COVERAGE;
  }
  if (token !== panel.loadToken || !panel.data) return;
  const unchanged = sameCoverage(coverageOf(panel.data), coverage);
  panel.data = { ...panel.data, ...coverage, coveragePending: false };
  if (unchanged) return;
  renderStats(panel.stats, panel.data);
  renderActions(project, panel);
  renderBody(project, panel);
}

async function load(project: string, fresh = false) {
  const panel = panelFor(project);
  const token = ++panel.loadToken;
  const known = coverageOf(panel.data);
  let data: LanternMap;
  let stamp = await readStamp(project);
  try {
    const lang = app.lanternLang.get(project);
    data = await (fresh ? window.ccmws.lanternLoad(project, lang, true) : window.ccmws.lanternLoad(project, lang));
    if (!data) throw new Error('no map');
  } catch {
    stamp = null;
    data = { exists: false, project: baseName(project), nodes: [], relations: [], errors: [], unmapped: [], unmappedCount: 0, total: 0, features: [], platforms: [], sections: [], warnings: [], language: { primary: 'en', code: 'en', available: [], fallbackCount: 0, fallbackKeys: [] }, prs: [], plans: [], brokenPlans: [] };
  }
  if (token !== panel.loadToken) return;
  const wantsCoverage = !!data.coveragePending;
  if (wantsCoverage && known) data = { ...data, ...known, coveragePending: false };
  panel.data = data;
  panel.stamp = stamp;
  panel.loadedAt = Date.now();
  if (data.exists && data.language.available.length > 1) app.lanternLang.set(project, data.language.code);
  panel.langEl = syncLang(panel.langEl, panel.noteEl, data.language, (code) => {
    app.lanternLang.set(project, code);
    load(project);
  });
  if (!screenUp(panel)) panel.noteEl.textContent = '';
  renderStats(panel.stats, panel.data);
  renderActions(project, panel);
  renderBody(project, panel);
  syncProblems(project, panel);
  if (!screenUp(panel)) void loadOffer(project, panel);
  if (wantsCoverage) void loadCoverage(project, panel, token, fresh);
}

function fetchPrs(project: string, force = false): Promise<FetchResult> {
  const running = fetching.get(project);
  if (running && (!force || forcedFetches.has(project))) return running;
  if (running) return running.then(() => fetchPrs(project, true));
  lastFetch.set(project, Date.now());
  if (force) forcedFetches.add(project);
  const job = (async (): Promise<FetchResult> => {
    try {
      return await (force ? window.ccmws.lanternFetchPrs(project, true) : window.ccmws.lanternFetchPrs(project));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  })().finally(() => {
    fetching.delete(project);
    forcedFetches.delete(project);
    const panel = panels.get(project);
    if (panel) renderActions(project, panel);
  });
  fetching.set(project, job);
  const panel = panels.get(project);
  if (panel) renderActions(project, panel);
  return job;
}

async function refreshPrs(project: string, force = true) {
  const result = await fetchPrs(project, force);
  if (app.lanternFront.has(project)) await (force ? load(project, result.ok) : reloadIfChanged(project, result.ok));
  return result;
}

function setFetchProblem(project: string, panel: Panel, result: FetchResult) {
  panel.fetchError = result.ok || isNoOrigin(result.error) ? null : shortError(result.error);
  syncProblems(project, panel);
}

async function reloadWithFetch(project: string, force = true) {
  const result = await refreshPrs(project, force);
  const panel = panels.get(project);
  if (panel) setFetchProblem(project, panel, result);
}

function autoFetch(project: string) {
  if (fetching.has(project)) return;
  const last = lastFetch.get(project);
  if (last !== undefined && Date.now() - last < FETCH_INTERVAL_MS) return;
  void reloadWithFetch(project, false);
}

function needsRefreshing(data: LanternMap | null) {
  return !!data && (data.unmappedCount > 0 || data.nodes.some(isMissing));
}

function sync() {
  const project = activeProjectPath();
  const front = !!project && app.lanternFront.has(project);
  hostEl.classList.toggle('hidden', !front);
  for (const [p, panel] of panels) {
    const shown = front && p === project;
    panel.el.classList.toggle('hidden', !shown);
    if (!shown) panel.problems.close();
  }
  syncPlanWindow();
  document.getElementById('mode-btn')?.setAttribute('aria-checked', String(front));
  window.dispatchEvent(new Event('mr:lantern-front'));
}

function setFront(project: string, front: boolean) {
  if (front) app.lanternFront.add(project);
  else {
    app.lanternFront.delete(project);
    panels.get(project)?.problems.close();
  }
  if (front) {
    closedWhileRunning.delete(project);
    panelFor(project);
  }
  sync();
  if (front) {
    load(project);
    autoFetch(project);
  }
}

function openLantern() {
  const project = activeProjectPath();
  if (project) setFront(project, true);
}

async function showCompare(project: string, id: string) {
  app.lanternPr.set(project, id);
  const mounted = !!panels.get(project)?.view;
  openLantern();
  if (!mounted) return;
  await load(project);
  panels.get(project)?.view?.selectPr(id);
}

function hideLantern() {
  const project = activeProjectPath();
  if (project) setFront(project, false);
}

function disposeLantern(project: string) {
  const panel = panels.get(project);
  if (!panel) return;
  if (panel.run.isActive()) {
    closedWhileRunning.add(project);
    return;
  }
  closedWhileRunning.delete(project);
  app.lanternFront.delete(project);
  panel.problems.dispose();
  panel.screen?.destroy();
  panel.view?.dispose();
  panel.integrations.dispose();
  panel.disposeProvider();
  panel.planFix.dispose();
  panel.el.remove();
  panels.delete(project);
}

async function readStamp(project: string): Promise<string | null> {
  try {
    return await window.ccmws.lanternStamp(project);
  } catch {
    return null;
  }
}

async function reloadIfChanged(project: string, fresh = false) {
  const panel = panels.get(project);
  if (!panel?.data || panel.stamp === null || Date.now() - panel.loadedAt >= FULL_RELOAD_MS) return load(project, fresh);
  const stamp = await readStamp(project);
  if (stamp === null || stamp !== panel.stamp) await load(project, fresh);
}

function reloadFront(fresh: boolean) {
  const project = activeProjectPath();
  if (project && app.lanternFront.has(project)) load(project, fresh);
}

window.addEventListener('mr:files-changed', () => reloadFront(true));
onSettingsChanged((changed) => {
  if (!affectsSetting('graph', changed)) return;
  const fold = settingValue('graph.foldFilesWhenZoomedOut');
  for (const p of panels.values()) p.view?.setFoldFiles(fold);
});
function refreshMap(project = activeProjectPath()) {
  if (project && !app.lanternFront.has(project)) setFront(project, true);
  const panel = project ? panels.get(project) : undefined;
  if (!project || !panel?.data?.exists) return;
  run(project, panel, 'lantern-refresh');
}

window.addEventListener('mr:agent-busy', () => {
  for (const [project, panel] of panels) {
    renderActions(project, panel);
    syncProblems(project, panel);
  }
});
window.addEventListener('mr:provider-changed', () => {
  reloadFront(false);
  syncSessions();
});
window.addEventListener('focus', () => {
  const project = activeProjectPath();
  if (!project || !app.lanternFront.has(project)) return;
  void reloadIfChanged(project);
  autoFetch(project);
});
export { disposeLantern, hideLantern, refreshMap, openLantern, showCompare, syncSessions, sync as syncLantern, toggleProblems };
