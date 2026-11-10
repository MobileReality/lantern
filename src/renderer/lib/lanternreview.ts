import { createCodeView } from './codemodal';
import { isLocalId, prRef } from '../../shared/local-review';
import type { ReadFile } from './codemodal';
import { fileIconHtml } from './file-icons';
import { esc } from './lanternctx';
import { createStepper } from './modalsteps';
import type { StepNav, Stepper } from './modalsteps';
import { reasonBlock } from './modalreason';
import type { ExplainHub } from './prexplain';
import { createDiffView } from './prdiffmodal';
import type { ReadDiff, ReadSemantic } from './prdiffmodal';
import { createReviewComments } from './comments/controller';
import type { CommentsOptions } from './comments/controller';

type ReviewMode = 'file' | 'diff';

interface ReviewTarget {
  pr: string;
  path: string;
  title?: string;
  branch?: string;
  order?: string[];
  reason?: string;
  head?: string;
  version?: string;
  nav?: StepNav;
  stat?: { added: number; removed: number };
}

interface ReviewOptions {
  readFile?: ReadFile;
  readDiff?: ReadDiff;
  readSemantic?: ReadSemantic;
  explain?: ExplainHub;
  comments?: CommentsOptions;
  onStep(path: string): void;
}

interface ReviewPane {
  el: HTMLElement;
  show(target: ReviewTarget | null): void;
  prefer(mode: ReviewMode): void;
  mode(): ReviewMode;
  focus(): void;
  canStep(): boolean;
  step(delta: number): boolean;
  stepKey(ev: KeyboardEvent): boolean;
  dispose(): void;
}

const EMPTY_TEXT = 'Pick a file in the list or on the graph to read it here.';
const NO_READER_TEXT = 'Files and diffs cannot be read in this window.';
const MODE_LABEL: Record<ReviewMode, string> = { file: 'File', diff: 'Diff' };
const MODE_KEY = 'lantern.reviewMode';

function savedMode(): ReviewMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'diff' ? 'diff' : 'file';
  } catch {
    return 'file';
  }
}

function saveMode(mode: ReviewMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function modeButton(mode: ReviewMode) {
  const button = el('button', 'lt-review-mode', MODE_LABEL[mode]);
  button.type = 'button';
  button.dataset.reviewMode = mode;
  return button;
}

function titleHtml(path: string) {
  const normalized = path.replaceAll('\\', '/');
  const cut = normalized.lastIndexOf('/');
  return `${fileIconHtml(path, 'file-label-icon')}<span class="lt-review-name"><b class="file-name">${esc(normalized.slice(cut + 1))}</b><span class="lt-review-path"><span class="file-directory">${esc(normalized.slice(0, cut + 1))}</span></span></span>`;
}

function statOf(stat: { added: number; removed: number }) {
  const box = el('span', 'lt-diff-stat');
  const add = el('span', 'df-stat-add', `+${stat.added}`);
  const del = el('span', 'df-stat-del', `\u2212${stat.removed}`);
  add.dataset.tip = `${stat.added} added`;
  del.dataset.tip = `${stat.removed} removed`;
  box.append(add, document.createTextNode(' '), del);
  return box;
}

function sameTarget(a: ReviewTarget | null, b: ReviewTarget | null) {
  return a?.pr === b?.pr && a?.path === b?.path && a?.reason === b?.reason && a?.head === b?.head && a?.version === b?.version && a?.nav?.index === b?.nav?.index && a?.nav?.files.length === b?.nav?.files.length;
}

function sameStat(a: ReviewTarget, b: ReviewTarget) {
  return a.stat?.added === b.stat?.added && a.stat?.removed === b.stat?.removed;
}

function keepsItsArrows(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [role="separator"], [role="tab"], .lt-cm-box, .lt-cm-pop, .lt-cm-add, [role="menu"]') !== null;
}

const SIDEWAYS: Record<string, -1 | 1> = { ArrowLeft: -1, ArrowRight: 1 };
const ANY_WAY: Record<string, -1 | 1> = { ...SIDEWAYS, ArrowUp: -1, ArrowDown: 1 };

function fileStepDelta(ev: KeyboardEvent, upDown: boolean): -1 | 1 | 0 {
  if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || keepsItsArrows(ev.target)) return 0;
  return (upDown ? ANY_WAY : SIDEWAYS)[ev.key] ?? 0;
}

function runFileStep(ev: KeyboardEvent, step: (delta: number) => unknown, upDown = false) {
  const delta = fileStepDelta(ev, upDown);
  if (!delta) return false;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  step(delta);
  return true;
}

function createReviewPane(opts: ReviewOptions): ReviewPane {
  const pane = el('section', 'lt-review');
  pane.tabIndex = -1;
  const head = el('div', 'lt-review-head');
  const top = el('div', 'lt-review-top');
  const bar = el('div', 'lt-review-bar');
  const title = el('div', 'lt-code-path lt-review-id');
  const modes = el('div', 'lt-review-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Show the file or its diff');
  const buttons: Record<ReviewMode, HTMLButtonElement> = { file: modeButton('file'), diff: modeButton('diff') };
  const code = opts.readFile ? createCodeView(opts.readFile, opts.readSemantic, true) : null;
  const diff = opts.readDiff ? createDiffView(opts.readDiff, opts.readSemantic) : null;
  const available: ReviewMode[] = [...(code ? (['file'] as const) : []), ...(diff ? (['diff'] as const) : [])];
  for (const mode of available) modes.append(buttons[mode]);
  modes.hidden = available.length < 2;
  const codeChrome = el('span', 'lt-review-chrome');
  const diffChrome = el('span', 'lt-review-chrome');
  if (code) codeChrome.append(code.note, code.toggle);
  if (diff) diffChrome.append(diff.toggle);
  const steps = el('div', 'lt-review-steps');
  top.append(title, steps);
  bar.append(modes, codeChrome, diffChrome);
  head.append(top, bar);
  const body = el('div', 'lt-review-body');
  if (code) body.append(code.body);
  if (diff) body.append(diff.body);
  const fileComments = el('div', 'lt-cm-file');
  const empty = el('p', 'lt-review-empty', EMPTY_TEXT);
  empty.setAttribute('role', 'status');
  pane.append(head, fileComments, body, empty);

  let wanted: ReviewMode = savedMode();
  let target: ReviewTarget | null = null;
  let painted: { target: ReviewTarget; mode: ReviewMode } | null = null;
  const loaded: Record<ReviewMode, string> = { file: '', diff: '' };
  let reason: HTMLElement | null = null;
  let explanation: HTMLElement | null = null;
  let stepper: Stepper | null = null;
  let stepperFor = '';
  let stepFiles: StepNav['files'] = [];

  function effectiveMode(): ReviewMode | null {
    return available.includes(wanted) ? wanted : (available[0] ?? null);
  }

  const comments = opts.comments
    ? createReviewComments(opts.comments, {
        area: body,
        fileHost: fileComments,
        bodies: { ...(code ? { file: code.body } : {}), ...(diff ? { diff: diff.body } : {}) },
        mode: effectiveMode,
        showMode(mode) {
          wanted = mode;
          render();
        },
      })
    : null;
  if (comments) bar.append(comments.tools);

  function paintSteps(nav: StepNav | undefined, pr: string) {
    steps.hidden = !nav;
    if (!nav) return;
    stepFiles = nav.files;
    const key = `${pr}\n${nav.files.length}`;
    if (!stepper || stepperFor !== key) {
      stepper = createStepper(nav, (index) => opts.onStep(stepFiles[index].path), () => buttons[effectiveMode() ?? 'file'].focus());
      stepperFor = key;
      steps.replaceChildren(stepper.el);
    }
    stepper.update(nav.index);
  }

  function paintStat(next: ReviewTarget) {
    title.querySelector('.lt-diff-stat')?.remove();
    if (next.stat) title.querySelector('.lt-review-path')?.append(statOf(next.stat));
  }

  function paintHead(next: ReviewTarget, mode: ReviewMode) {
    title.dataset.tip = next.path;
    title.innerHTML = titleHtml(next.path);
    paintStat(next);
    pane.setAttribute('aria-label', `${MODE_LABEL[mode]} of ${next.path} in ${isLocalId(next.pr) ? 'local comparison' : 'pull request'} ${prRef(next.pr)}`);
    for (const each of available) buttons[each].setAttribute('aria-pressed', String(each === mode));
    codeChrome.hidden = mode !== 'file';
    diffChrome.hidden = mode !== 'diff';
    if (code) code.body.hidden = mode !== 'file';
    if (diff) diff.body.hidden = mode !== 'diff';
    reason?.remove();
    reason = reasonBlock(next.reason);
    if (reason) head.after(reason);
    explanation?.remove();
    explanation = opts.explain && next.head ? opts.explain.row({ pr: next.pr, path: next.path, head: next.head }) : null;
    if (explanation) (reason ?? head).after(explanation);
    paintSteps(next.nav, next.pr);
    comments?.setTarget({ pr: { id: next.pr, title: next.title ?? '', branch: next.branch ?? '' }, path: next.path, order: next.order ?? [] });
  }

  function load(next: ReviewTarget, mode: ReviewMode) {
    const key = `${next.pr}\n${next.version ?? ''}\n${next.path}`;
    if (loaded[mode] === key) return;
    loaded[mode] = key;
    if (mode === 'file') code?.load(next.path, '');
    else diff?.load(next.pr, next.path);
  }

  function render() {
    const mode = effectiveMode();
    const current = target;
    const idle = !current || !mode;
    head.hidden = idle;
    body.hidden = idle;
    empty.hidden = !idle;
    empty.textContent = mode ? EMPTY_TEXT : NO_READER_TEXT;
    if (idle) {
      painted = null;
      loaded.file = '';
      loaded.diff = '';
      title.textContent = '';
      delete title.dataset.tip;
      reason?.remove();
      reason = null;
      explanation?.remove();
      explanation = null;
      comments?.setTarget(null);
      pane.setAttribute('aria-label', 'Selected file');
      return;
    }
    if (painted && painted.mode === mode && sameTarget(painted.target, current)) {
      if (!sameStat(painted.target, current)) paintStat(current);
      painted = { target: current, mode };
      return;
    }
    const switched = !!painted && painted.mode !== mode;
    painted = { target: current, mode };
    paintHead(current, mode);
    if (switched) comments?.modeChanged();
    load(current, mode);
  }

  function step(delta: number) {
    return !!target?.nav && !!stepper?.step(delta);
  }

  modes.addEventListener('click', (ev) => {
    const button = (ev.target as Element).closest('button[data-review-mode]') as HTMLElement | null;
    if (!button) return;
    wanted = button.dataset.reviewMode as ReviewMode;
    saveMode(wanted);
    render();
  });

  pane.addEventListener('keydown', (ev) => {
    if (target?.nav) runFileStep(ev, step);
  });

  render();
  return {
    el: pane,
    show(next) {
      target = next;
      render();
    },
    prefer(mode) {
      wanted = mode;
    },
    mode: () => effectiveMode() ?? wanted,
    focus: () => pane.focus({ preventScroll: true }),
    canStep: () => !!target?.nav && !!stepper,
    step,
    stepKey: (ev) => !keepsItsArrows(ev.target) && !!target?.nav && !!stepper?.handleKey(ev),
    dispose() {
      comments?.dispose();
    },
  };
}

export { createReviewPane, runFileStep };
export type { ReviewMode, ReviewPane, ReviewTarget };
