import { baseName } from './util';
import { PHASES, failureNote, formatElapsed, formatEta, resumeLabel } from './setupprogress';
import type { Phase } from './setupprogress';
import type { SetupRun } from './setuprun';

const TITLES: Record<Phase, string> = {
  planning: 'Planning the map',
  features: 'Finding the feature areas',
  mapping: 'Mapping the code',
  sections: 'Writing the sections',
  finishing: 'Checking the result',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stat(label: string): { box: HTMLElement; value: HTMLElement } {
  const box = el('div', 'ls-stat');
  const value = el('dd', 'ls-stat-value', '–');
  const term = el('dt', 'ls-stat-label', label);
  box.append(term, value);
  return { box, value };
}

interface ScreenOptions {
  project: string;
  run: SetupRun;
  isBusy(): boolean;
  onView?: () => void;
}

function mountSetupScreen(host: HTMLElement, { project, run, isBusy, onView }: ScreenOptions) {
  const root = el('section', 'ls-screen');
  const card = el('div', 'ls-card');
  const eyebrow = el('p', 'ls-eyebrow');
  const head = el('div', 'ls-head');
  const percent = el('div', 'ls-percent', '–');
  const titles = el('div', 'ls-titles');
  const title = el('h2', 'ls-title');
  const activity = el('p', 'ls-activity');
  activity.setAttribute('aria-live', 'polite');
  titles.append(title, activity);
  head.append(percent, titles);

  const phases = el('ol', 'ls-phases');
  const phaseItems = new Map<string, HTMLElement>();
  for (const phase of PHASES) {
    const item = el('li', 'ls-phase', phase.label);
    phaseItems.set(phase.id, item);
    phases.appendChild(item);
  }

  const bar = el('div', 'ls-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Map progress');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = el('div', 'ls-fill');
  bar.appendChild(fill);

  const meta = el('div', 'ls-meta');
  const where = el('span', 'ls-where');
  const time = el('span', 'ls-time');
  meta.append(where, time);

  const counts = el('dl', 'ls-counts');
  const files = stat('Files mapped');
  const chunks = stat('Chunks done');
  const left = stat('Chunks left');
  counts.append(files.box, chunks.box, left.box);

  const note = el('p', 'ls-note');
  const actions = el('div', 'ls-actions');
  const stop = el('button', 'lt-btn ls-stop', 'Stop');
  stop.type = 'button';
  const resume = el('button', 'lt-btn lt-primary ls-resume');
  resume.type = 'button';
  const view = el('button', 'lt-btn ls-view', 'View the map so far');
  view.type = 'button';
  const toggle = el('button', 'ls-toggle', 'Show details');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  actions.append(stop, resume, view, toggle);

  const log = el('div', 'lt-log ls-log hidden');
  log.id = `ls-log-${Math.random().toString(36).slice(2, 8)}`;
  toggle.setAttribute('aria-controls', log.id);

  card.append(eyebrow, head, phases, bar, meta, counts, note, actions, log);
  root.appendChild(card);
  host.appendChild(root);

  let shown = 0;
  const setDetails = (open: boolean) => {
    log.classList.toggle('hidden', !open);
    toggle.textContent = open ? 'Hide details' : 'Show details';
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setDetails(log.classList.contains('hidden')));
  stop.addEventListener('click', () => run.stop());
  resume.addEventListener('click', () => void run.resume());
  view.addEventListener('click', () => onView?.());

  function renderLog() {
    if (run.log.length < shown) {
      log.textContent = '';
      shown = 0;
    }
    for (; shown < run.log.length; shown++) {
      const line = el('div', `ls-log-line${run.log[shown].cls ? ` ${run.log[shown].cls}` : ''}`, run.log[shown].text);
      log.appendChild(line);
    }
    log.scrollTop = log.scrollHeight;
  }

  function render() {
    const state = run.state;
    const v = run.view();
    const kind = state.kind ?? 'lantern';
    const running = state.phase === 'running';
    root.dataset.state = state.phase;
    eyebrow.textContent = `${kind === 'lantern' ? 'Setting up' : 'Refreshing'} · ${baseName(project)}`;

    const pct = state.phase === 'done' ? 100 : Math.min(99, Math.floor(v.fraction * 100));
    percent.textContent = v.known ? `${pct}%` : '–';
    bar.setAttribute('aria-valuenow', String(pct));
    bar.classList.toggle('ls-bar-unknown', !v.known && running);
    fill.style.width = `${v.known ? Math.max(v.fraction * 100, 0) : 0}%`;

    if (state.phase === 'stopped') title.textContent = 'Stopped';
    else if (state.phase === 'failed') title.textContent = 'The run stopped early';
    else if (state.phase === 'done') title.textContent = state.summary ? `Done · ${state.summary}` : 'Done';
    else title.textContent = TITLES[v.phase];
    activity.textContent = running ? state.activity : v.filesText;

    const order = PHASES.findIndex((p) => p.id === v.phase);
    PHASES.forEach((p, i) => {
      const item = phaseItems.get(p.id) as HTMLElement;
      const status = state.phase === 'done' || i < order ? 'done' : i === order ? (running ? 'current' : 'paused') : 'todo';
      item.dataset.status = status;
      if (status === 'current') item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });

    const bits = [v.chunkText, v.currentDir && running ? v.currentDir : ''].filter(Boolean);
    where.textContent = bits.length ? bits.join(' · ') : v.filesText;
    const eta = running && v.etaMs !== null ? ` · ${formatEta(v.etaMs)} left` : '';
    time.textContent = state.phase === 'idle' ? '' : `${formatElapsed(v.elapsedMs)} ${state.resumed ? 'this sitting' : 'elapsed'}${eta}`;

    files.value.textContent = v.known ? `${v.filesDone} / ${v.filesTotal}` : '–';
    chunks.value.textContent = v.known ? `${v.chunksDone} / ${v.chunksTotal}` : '–';
    left.value.textContent = v.known ? String(v.chunksLeft) : '–';

    if (state.phase === 'stopped') {
      note.textContent = v.chunksLeft > 0 ? `Everything already written to .lantern/ is kept. Resume continues with the ${v.chunksLeft} chunks left; finished chunks are not redone.` : 'Everything already written to .lantern/ is kept. Only the final steps are left.';
    } else if (state.phase === 'failed') {
      note.textContent = failureNote(state.error);
    } else {
      note.textContent = '';
    }
    note.hidden = !note.textContent;

    stop.hidden = !running;
    const canResume = run.canResume();
    resume.hidden = !canResume;
    view.hidden = !canResume || !onView;
    resume.disabled = isBusy();
    resume.textContent = resumeLabel(state.progress, kind);
    root.classList.toggle('ls-live', running);
    renderLog();
  }

  const off = run.subscribe(render);
  render();
  return {
    destroy() {
      off();
      root.remove();
    },
  };
}

export { mountSetupScreen };
