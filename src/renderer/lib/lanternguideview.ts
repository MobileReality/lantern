import type { LanternGuide, LanternGuideStep, LanternPr } from '../../main/lantern';
import { fileLabelHtml } from './file-label';
import { NO_STEP, guideOf, pathsOf } from './lanternguide';
import type { GuideStop } from './lanternguide';

interface GuidePaneOptions {
  open(path: string, step: number): void;
}

interface GuidePaneState {
  stops: readonly GuideStop[];
  at: number;
  marked?: ReadonlySet<string>;
}

interface GuidePane {
  el: HTMLElement;
  show(pr: LanternPr | undefined, state: GuidePaneState): void;
  dispose(): void;
}

interface Ticks {
  done: Set<number>;
  toggled: Set<number>;
  pseudo: Set<number>;
}

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const;
const REST_TITLE = 'Not in a step';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function button(cls: string, text: string, data: Record<string, string> = {}) {
  const node = el('button', cls, text);
  node.type = 'button';
  for (const [key, value] of Object.entries(data)) node.dataset[key] = value;
  return node;
}

function flip(set: Set<number>, index: number) {
  if (!set.delete(index)) set.add(index);
}

function newTicks(): Ticks {
  return { done: new Set(), toggled: new Set(), pseudo: new Set() };
}

function fileItem(path: string, step: number) {
  const item = el('li', 'lt-guide-file');
  item.dataset.path = path;
  const open = button('lt-guide-file-name', '', { guideOpen: path, guideStep: String(step) });
  open.innerHTML = fileLabelHtml(path);
  open.dataset.tip = path;
  open.setAttribute('aria-label', `Open ${path}`);
  item.append(open);
  return item;
}

function createGuidePane(opts: GuidePaneOptions): GuidePane {
  const root = el('section', 'lt-guide-pane');
  const states = new Map<string, Ticks>();
  let guide: LanternGuide | null = null;
  let shownFor: { id: string; guide: LanternGuide; stops: string } | null = null;
  let ticks = newTicks();

  const isOpen = (index: number) => (guide?.steps[index].careful ?? false) !== ticks.toggled.has(index);
  const stepEl = (index: number) => root.querySelector<HTMLElement>(`.lt-guide-step[data-step="${index}"]`);

  function syncStep(index: number, current: boolean) {
    const step = stepEl(index);
    if (!step) return;
    const open = isOpen(index);
    const done = ticks.done.has(index);
    const pseudo = ticks.pseudo.has(index);
    step.dataset.open = String(open);
    step.dataset.done = String(done);
    step.dataset.current = String(current);
    if (current) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
    step.querySelector<HTMLElement>('.lt-guide-fold')?.setAttribute('aria-expanded', String(open));
    step.querySelector<HTMLElement>('.lt-guide-step-body')?.toggleAttribute('hidden', !open);
    step.querySelector<HTMLElement>('.lt-guide-pseudo')?.toggleAttribute('hidden', !pseudo);
    step.querySelector<HTMLElement>('.lt-guide-pseudo-toggle')?.setAttribute('aria-pressed', String(pseudo));
    const check = step.querySelector<HTMLInputElement>('.lt-guide-check');
    if (check) check.checked = done;
  }

  function syncFiles(state: GuidePaneState) {
    const here = state.stops[state.at];
    root.querySelectorAll<HTMLElement>('.lt-guide-file').forEach((item) => {
      const group = item.closest<HTMLElement>('[data-group]');
      const path = item.dataset.path ?? '';
      const current = !!here && group?.dataset.group === String(here.step) && path === here.path;
      item.dataset.current = String(current);
      item.dataset.same = String(!current && !!here && path === here.path);
      item.dataset.flow = String(!!state.marked?.has(path));
      const open = item.querySelector<HTMLElement>('.lt-guide-file-name');
      if (current) open?.setAttribute('aria-current', 'true');
      else open?.removeAttribute('aria-current');
    });
  }

  function sync(state: GuidePaneState) {
    if (!guide) return;
    const here = state.stops[state.at];
    guide.steps.forEach((_, index) => { syncStep(index, here?.step === index); });
    syncFiles(state);
  }

  function stepItem(step: LanternGuideStep, index: number) {
    const item = el('li', 'lt-guide-step');
    item.dataset.step = String(index);
    item.dataset.group = String(index);
    item.dataset.careful = String(step.careful);
    const where = `lt-guide-body-${index}`;
    const top = el('div', 'lt-guide-step-top');
    const check = el('input', 'lt-guide-check');
    check.type = 'checkbox';
    check.dataset.guideDone = String(index);
    check.setAttribute('aria-label', `Mark step ${index + 1} done: ${step.title}`);
    const fold = button('lt-guide-fold', '', { guideFold: String(index) });
    fold.setAttribute('aria-controls', where);
    fold.append(el('span', 'lt-guide-num', String(index + 1)), el('span', 'lt-guide-title', step.title), el('span', 'lt-guide-meta', step.careful ? 'careful' : 'skim'));
    top.append(check, fold);
    const body = el('div', 'lt-guide-step-body');
    body.id = where;
    body.append(el('p', 'lt-guide-why', step.why));
    if (step.pseudo?.length) {
      const toggle = button('lt-guide-pseudo-toggle', 'Pseudocode', { guidePseudo: String(index) });
      toggle.setAttribute('aria-pressed', 'false');
      const code = el('pre', 'lt-guide-pseudo', step.pseudo.join('\n'));
      code.setAttribute('aria-label', `Pseudocode of step ${index + 1}`);
      body.append(toggle, code);
    }
    const files = el('ul', 'lt-guide-files');
    files.append(...pathsOf(step.hunks).map((path) => fileItem(path, index)));
    item.append(top, body, files);
    return item;
  }

  function restItem(paths: readonly string[]) {
    const item = el('li', 'lt-guide-rest');
    item.dataset.group = String(NO_STEP);
    const files = el('ul', 'lt-guide-files');
    files.append(...paths.map((path) => fileItem(path, NO_STEP)));
    item.append(el('h2', 'lt-guide-rest-title', REST_TITLE), files);
    return item;
  }

  function paint(next: LanternGuide, id: string, state: GuidePaneState) {
    const head = el('header', 'lt-guide-head');
    head.append(el('p', 'lt-guide-summary', next.summary));
    const risk = el('p', 'lt-guide-risk');
    risk.dataset.level = next.risk.level;
    risk.append(el('b', 'lt-guide-level', RISK_LABEL[next.risk.level]), document.createTextNode(` ${next.risk.why}`));
    head.append(risk);
    const steps = el('ol', 'lt-guide-steps');
    steps.setAttribute('aria-label', 'Steps');
    steps.append(...next.steps.map(stepItem));
    const rest = state.stops.filter((stop) => stop.step === NO_STEP).map((stop) => stop.path);
    if (rest.length) steps.append(restItem(rest));
    root.replaceChildren(head, steps);
    root.setAttribute('aria-label', `Guide of pull request #${id}`);
  }

  function onClick(ev: Event) {
    const target = ev.target as Element;
    const open = target.closest<HTMLElement>('[data-guide-open]');
    if (open) return opts.open(open.dataset.guideOpen ?? '', Number(open.dataset.guideStep));
    const fold = target.closest<HTMLElement>('[data-guide-fold]');
    const pseudo = target.closest<HTMLElement>('[data-guide-pseudo]');
    if (fold) flip(ticks.toggled, Number(fold.dataset.guideFold));
    if (pseudo) flip(ticks.pseudo, Number(pseudo.dataset.guidePseudo));
    const owner = (fold ?? pseudo)?.closest<HTMLElement>('.lt-guide-step');
    if (owner) syncStep(Number(owner.dataset.step), owner.dataset.current === 'true');
  }

  function onChange(ev: Event) {
    const check = (ev.target as Element).closest<HTMLInputElement>('[data-guide-done]');
    if (!check) return;
    const index = Number(check.dataset.guideDone);
    if (check.checked) ticks.done.add(index);
    else ticks.done.delete(index);
    syncStep(index, stepEl(index)?.dataset.current === 'true');
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  return {
    el: root,
    show(next, state) {
      const nextGuide = guideOf(next);
      if (!next || !nextGuide) {
        guide = null;
        shownFor = null;
        root.replaceChildren();
        return;
      }
      const stops = state.stops.map((stop) => `${stop.step}:${stop.path}`).join('\0');
      if (shownFor?.id !== next.id || shownFor.guide !== nextGuide || shownFor.stops !== stops) {
        guide = nextGuide;
        shownFor = { id: next.id, guide: nextGuide, stops };
        ticks = states.get(next.id) ?? newTicks();
        states.set(next.id, ticks);
        paint(nextGuide, next.id, state);
      }
      sync(state);
    },
    dispose() {
      root.replaceChildren();
    },
  };
}

export { createGuidePane };
export type { GuidePane, GuidePaneOptions, GuidePaneState };
