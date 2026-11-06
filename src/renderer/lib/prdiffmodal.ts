import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import { fileLabelHtml } from './file-label';
import { isLocalId, prRef } from '../../shared/local-review';
import type { PrFileDiff } from '../../main/lantern-prdiff';
import type { BaseSource, PrSides } from '../../main/lantern-pr-revisions';
import { langFor, parseDiffRows, semanticLanguageFor } from './codeview';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES } from '../../shared/code-preview';
import type { DiffRow } from './codeview';
import { diffStats, hasFold, planDiff } from './diffcollapse';
import { applyDiffSemantic, diffLexicalLines, renderDiff } from './diffview';
import type { DiffSemantic } from './diffview';
import type { CodeSource, SemanticHighlightResult } from '../../shared/code-highlighting';
import { semanticLimitNotices } from './semantic-limit-notice';

import { createStepper } from './modalsteps';
import type { StepNav } from './modalsteps';
import { reasonBlock } from './modalreason';

type ReadDiff = (pr: string, path: string, sides?: PrSides) => Promise<PrFileDiff>;
type ReadSemantic = (path: string, source: CodeSource) => Promise<SemanticHighlightResult>;


let dismissActive: (() => void) | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function notice(text: string) {
  return el('div', 'rv-trunc', text);
}

interface DiffChrome {
  stat: HTMLElement;
  toggle: HTMLButtonElement;
}

let showAllLines = false;

function clearChrome(chrome: DiffChrome) {
  chrome.stat.textContent = '';
  chrome.toggle.hidden = true;
}

function paintChrome(chrome: DiffChrome, rows: DiffRow[], foldable: boolean) {
  const { added, removed } = diffStats(rows);
  chrome.stat.textContent = '';
  const add = el('span', 'df-stat-add', `+${added}`);
  const del = el('span', 'df-stat-del', `\u2212${removed}`);
  add.dataset.tip = `${added} added`;
  del.dataset.tip = `${removed} removed`;
  chrome.stat.append(add, document.createTextNode(' '), del);
  chrome.toggle.hidden = !foldable;
  chrome.toggle.textContent = showAllLines ? 'Collapse unchanged' : 'Show all lines';
  chrome.toggle.setAttribute('aria-pressed', String(showAllLines));
}

interface SideChoice {
  choose(sides: PrSides): void;
  reset(): void;
}

const BASE_SOURCE_TEXT: Record<BaseSource, string> = { recorded: 'the recorded base', host: 'the base the host reports', default: 'the default line', chosen: 'the base you chose' };

function selectOf(label: string, names: string[]) {
  const wrap = el('label', 'lt-diff-side', `${label} `);
  const select = el('select', 'lt-diff-side-select');
  for (const name of names) select.append(new Option(name, name));
  wrap.append(select);
  return { wrap, select };
}

function sidePicker(res: PrFileDiff, side: SideChoice) {
  const candidates = res.candidates!;
  const box = el('div', 'lt-diff-pick');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Choose the two sides to compare');
  const base = selectOf('Base', candidates.bases);
  const branch = selectOf('Pull request branch', candidates.branches);
  const apply = el('button', 'lt-diff-toggle', 'Show diff');
  apply.type = 'button';
  apply.disabled = !candidates.bases.length || !candidates.branches.length;
  apply.addEventListener('click', () => side.choose({ base: base.select.value, branch: branch.select.value }));
  box.append(base.wrap, branch.wrap, apply);
  return box;
}

function againstNotice(res: PrFileDiff, side: SideChoice) {
  const against = res.against!;
  const box = notice(`Compared against ${against.name} (${BASE_SOURCE_TEXT[against.source]})${against.source === 'chosen' || !res.recordedBase ? '' : `; the recorded base ${res.recordedBase} is not available here`}.`);
  if (against.source === 'chosen') {
    const undo = el('button', 'lt-diff-toggle', 'Use the default comparison');
    undo.type = 'button';
    undo.addEventListener('click', () => side.reset());
    box.append(' ', undo);
  }
  return box;
}

function fill(body: HTMLElement, path: string, res: PrFileDiff, chrome: DiffChrome, lexical: Map<number, string>, semantic?: DiffSemantic, semanticResults: Array<SemanticHighlightResult | undefined> = [], side?: SideChoice) {
  body.textContent = '';
  clearChrome(chrome);
  if (!res.ok) {
    body.appendChild(notice(`Diff not available: ${res.reason || 'unknown reason'}.`));
    if (res.candidates && side) {
      body.appendChild(notice('Choose what to compare: the base and the branch that holds the pull request changes. The choice applies to this pull request here only; the pull request record is not edited.'));
      body.appendChild(sidePicker(res, side));
    }
    return;
  }
  if (res.against && side) body.appendChild(againstNotice(res, side));
  if (res.binary) return void body.appendChild(notice('Binary file: no text diff to show.'));
  if (!res.diff.trim()) return void body.appendChild(notice('No changes to this file in this pull request.'));
  const rows = parseDiffRows(res.diff);
  const collapsed = planDiff(rows, true);
  paintChrome(chrome, rows, hasFold(collapsed));
  body.appendChild(renderDiff(rows, lexical, showAllLines ? planDiff(rows, false) : collapsed, semantic, semanticLanguageFor(path)));
  body.prepend(...semanticLimitNotices(semanticResults));
  if (res.truncated) body.appendChild(notice(`Diff too large: showing only the first ${CODE_VIEW_MAX_LINES} lines (${Math.round(CODE_HL_MAX_BYTES / 1000)} KB max).`));
}

interface DiffView {
  body: HTMLElement;
  stat: HTMLElement;
  toggle: HTMLButtonElement;
  load(pr: string, path: string): void;
}

function createDiffView(read: ReadDiff, readSemantic?: ReadSemantic): DiffView {
  const stat = el('span', 'lt-diff-stat');
  const toggle = el('button', 'lt-diff-toggle');
  toggle.type = 'button';
  toggle.hidden = true;
  const chrome: DiffChrome = { stat, toggle };
  const body = el('div', 'rv-code lt-code-body');
  let ticket = 0;
  let loaded: { path: string; res: PrFileDiff } | null = null;
  let lexical = new Map<number, string>();
  let semantics: DiffSemantic | undefined;
  let semanticResults: Array<SemanticHighlightResult | undefined> = [];
  const chosen = new Map<string, PrSides>();
  let current: { pr: string; path: string } | null = null;
  const side: SideChoice = {
    choose(sides) {
      if (!current) return;
      chosen.set(current.pr, sides);
      load(current.pr, current.path);
    },
    reset() {
      if (!current) return;
      chosen.delete(current.pr);
      load(current.pr, current.path);
    },
  };

  function load(pr: string, path: string) {
    current = { pr, path };
    loaded = null;
    semantics = {};
    semanticResults = [];
    clearChrome(chrome);
    body.textContent = '';
    body.appendChild(notice('Loading…'));
    body.scrollTop = 0;
    const mine = ++ticket;
    const sides = chosen.get(pr);
    (sides ? read(pr, path, sides) : read(pr, path)).then(
      (res) => {
        if (!body.isConnected || mine !== ticket) return;
        const rows = res.ok && !res.binary ? parseDiffRows(res.diff) : [];
        void diffLexicalLines(rows, langFor(path)).then((result) => {
          if (!body.isConnected || mine !== ticket) return;
          lexical = result;
          loaded = { path, res };
          fill(body, path, res, chrome, lexical, semantics, semanticResults, side);
          body.scrollTop = 0;
        });
        if (readSemantic) void Promise.all([
          res.oldSource ? readSemantic(path, res.oldSource) : undefined,
          res.newSource ? readSemantic(path, res.newSource) : undefined,
        ]).then(([old, next]) => {
          if (!body.isConnected || mine !== ticket) return;
          semanticResults = [old, next];
          if (old?.ok) semantics!.old = old;
          if (next?.ok) semantics!.new = next;
          applyDiffSemantic(body, semantics!, semanticLanguageFor(path));
          body.querySelectorAll('.semantic-limit-notice').forEach((notice) => { notice.remove(); });
          body.prepend(...semanticLimitNotices(semanticResults));
        }, () => {});
      },
      () => {
        if (!body.isConnected || mine !== ticket) return;
        body.textContent = '';
        clearChrome(chrome);
        body.appendChild(notice('Diff not available: could not read it.'));
      },
    );
  }

  toggle.addEventListener('click', () => {
    showAllLines = !showAllLines;
    if (!loaded) return;
    fill(body, loaded.path, loaded.res, chrome, lexical, semantics, semanticResults, side);
    body.scrollTop = 0;
  });
  return { body, stat, toggle, load };
}

function openPrDiffModal(host: HTMLElement, read: ReadDiff, pr: string, path: string, reason?: string, nav?: StepNav, readSemantic?: ReadSemantic) {
  dismissActive?.();
  const opener = document.activeElement as HTMLElement | null;
  const modal = el('div', 'modal lt-code-modal lt-diff-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const card = el('div', 'modal-card lt-code-card');
  const head = el('div', 'modal-head');
  const title = el('span', 'modal-title lt-code-path');
  const close = el('button', 'modal-close');
  close.dataset.tip = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close diff');
  close.innerHTML = CLOSE_ICON;
  const stepper = nav ? createStepper(nav, show, () => close.focus()) : null;
  const view = createDiffView(read, readSemantic);
  head.append(title, el('span', 'lt-code-note'), view.stat, view.toggle);
  if (stepper) head.append(stepper.el);
  head.append(close);
  card.append(head, view.body);
  modal.appendChild(card);
  let reasonEl: HTMLElement | null = null;

  function show(index: number) {
    const file = nav ? nav.files[index] : { path, reason };
    stepper?.update(index);
    title.dataset.tip = file.path;
    title.innerHTML = fileLabelHtml(file.path);
    title.append(document.createTextNode(' '), el('span', 'sym', prRef(pr)));
    modal.setAttribute('aria-label', `Diff of ${file.path} in ${isLocalId(pr) ? 'local comparison' : 'pull request'} ${prRef(pr)}`);
    reasonEl?.remove();
    reasonEl = reasonBlock(file.reason);
    if (reasonEl) head.after(reasonEl);
    view.load(pr, file.path);
  }

  function dismiss() {
    window.removeEventListener('keydown', onKey, true);
    if (dismissActive === dismiss) dismissActive = null;
    modal.remove();
    if (opener?.isConnected) opener.focus();
  }
  function onKey(ev: KeyboardEvent) {
    if (!modal.isConnected) {
      if (ev.key === 'Escape') dismiss();
      return;
    }
    if (stepper?.handleKey(ev)) return;
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    dismiss();
  }
  dismissActive = dismiss;
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', dismiss);
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) dismiss();
  });
  host.appendChild(modal);
  close.focus();
  show(nav ? nav.index : 0);
}

export { createDiffView, openPrDiffModal };
export type { DiffView, ReadDiff, ReadSemantic };
