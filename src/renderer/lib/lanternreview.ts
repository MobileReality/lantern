import { createCodeView } from './codemodal';
import { isLocalId, prRef } from '../../shared/local-review';
import type { ReadFile } from './codemodal';
import { fileLabelHtml } from './file-label';
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
  stepKey(ev: KeyboardEvent): boolean;
  dispose(): void;
}

const EMPTY_TEXT = 'Pick a file in the list or on the graph to read it here.';
const NO_READER_TEXT = 'Files and diffs cannot be read in this window.';
const MODE_LABEL: Record<ReviewMode, string> = { file: 'File', diff: 'Diff' };

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

function sameTarget(a: ReviewTarget | null, b: ReviewTarget | null) {
  return a?.pr === b?.pr && a?.path === b?.path && a?.reason === b?.reason && a?.head === b?.head && a?.version === b?.version && a?.nav?.index === b?.nav?.index && a?.nav?.files.length === b?.nav?.files.length;
}

function keepsItsArrows(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [role="separator"], [role="tab"], .lt-cm-box, .lt-cm-pop') !== null;
}

function createReviewPane(opts: ReviewOptions): ReviewPane {
  const pane = el('section', 'lt-review');
  pane.tabIndex = -1;
  const head = el('div', 'lt-review-head');
  const title = el('span', 'lt-code-path');
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
  if (diff) diffChrome.append(diff.stat, diff.toggle);
  const steps = el('div', 'lt-review-steps');
  head.append(title, codeChrome, diffChrome, modes, steps);
  const body = el('div', 'lt-review-body');
  if (code) body.append(code.body);
  if (diff) body.append(diff.body);
  const fileComments = el('div', 'lt-cm-file');
  const empty = el('p', 'lt-review-empty', EMPTY_TEXT);
  empty.setAttribute('role', 'status');
  pane.append(head, fileComments, body, empty);

  let wanted: ReviewMode = 'file';
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
  if (comments) modes.before(comments.tools);

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

  function paintHead(next: ReviewTarget, mode: ReviewMode) {
    title.dataset.tip = next.path;
    title.innerHTML = fileLabelHtml(next.path);
    if (!isLocalId(next.pr)) title.append(document.createTextNode(' '), el('span', 'sym', prRef(next.pr)));
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
    if (painted && painted.mode === mode && sameTarget(painted.target, current)) return;
    const switched = !!painted && painted.mode !== mode;
    painted = { target: current, mode };
    paintHead(current, mode);
    if (switched) comments?.modeChanged();
    load(current, mode);
  }

  modes.addEventListener('click', (ev) => {
    const button = (ev.target as Element).closest('button[data-review-mode]') as HTMLElement | null;
    if (!button) return;
    wanted = button.dataset.reviewMode as ReviewMode;
    render();
  });

  pane.addEventListener('keydown', (ev) => {
    if (target?.nav && !keepsItsArrows(ev.target)) stepper?.handleKey(ev);
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
    stepKey: (ev) => !keepsItsArrows(ev.target) && !!target?.nav && !!stepper?.handleKey(ev),
    dispose() {
      comments?.dispose();
    },
  };
}

export { createReviewPane };
export type { ReviewMode, ReviewPane, ReviewTarget };
