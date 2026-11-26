import type { LanternGuide, LanternGuideStep, LanternPr } from '../../main/lantern';
import { langFor, parseDiffRows, semanticLanguageFor } from './codeview';
import { planDiff } from './diffcollapse';
import { diffLexicalLines, renderDiff } from './diffview';
import { fileLabelHtml } from './file-label';
import { guideOf, pathsOf, refsOf, selectRows } from './lanternguide';
import type { ReadDiff } from './prdiffmodal';

interface GuideViewOptions {
  readDiff?: ReadDiff;
  open(path: string): void;
}

interface GuideView {
  el: HTMLElement;
  show(pr: LanternPr | undefined): void;
  move(delta: 1 | -1): void;
  handleKey(ev: KeyboardEvent): boolean;
  dispose(): void;
}

interface GuideState {
  done: Set<number>;
  toggled: Set<number>;
  pseudo: Set<number>;
  current: number;
}

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const;
const NO_READER_TEXT = 'Diffs cannot be read in this window.';
const KEEPS_KEYS = 'input, textarea, select, [contenteditable="true"]';

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

function notice(text: string) {
  return el('div', 'rv-trunc', text);
}

function flip(set: Set<number>, index: number) {
  if (!set.delete(index)) set.add(index);
}

function newState(): GuideState {
  return { done: new Set(), toggled: new Set(), pseudo: new Set(), current: 0 };
}

function createGuideView(opts: GuideViewOptions): GuideView {
  const root = el('section', 'lt-guide-view');
  const states = new Map<string, GuideState>();
  let pr: LanternPr | undefined;
  let guide: LanternGuide | null = null;
  let state = newState();
  let tickets = 0;

  const isOpen = (index: number) => (guide?.steps[index].careful ?? false) !== state.toggled.has(index);
  const stepEl = (index: number) => root.querySelector<HTMLElement>(`.lt-guide-step[data-step="${index}"]`);

  function sync() {
    if (!guide) return;
    guide.steps.forEach((_, index) => {
      const step = stepEl(index);
      const rail = root.querySelector<HTMLElement>(`.lt-guide-rail-item[data-step="${index}"]`);
      const open = isOpen(index);
      const current = index === state.current;
      const done = state.done.has(index);
      if (step) {
        step.dataset.open = String(open);
        step.dataset.done = String(done);
        if (current) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
        step.dataset.current = String(current);
        step.querySelector<HTMLElement>('.lt-guide-fold')?.setAttribute('aria-expanded', String(open));
        step.querySelector<HTMLElement>('.lt-guide-step-body')?.toggleAttribute('hidden', !open);
        const pseudo = state.pseudo.has(index);
        step.querySelector<HTMLElement>('.lt-guide-pseudo')?.toggleAttribute('hidden', !pseudo);
        step.querySelector<HTMLElement>('.lt-guide-pseudo-toggle')?.setAttribute('aria-pressed', String(pseudo));
      }
      if (rail) {
        rail.dataset.current = String(current);
        rail.dataset.done = String(done);
        if (current) rail.setAttribute('aria-current', 'step');
        else rail.removeAttribute('aria-current');
        const check = rail.querySelector<HTMLInputElement>('input');
        if (check) check.checked = done;
      }
    });
    const open = [...root.querySelectorAll<HTMLElement>('.lt-guide-step[data-open="true"] .lt-guide-hunks:not([data-loaded])')];
    for (const box of open) void fillHunks(box, Number(box.dataset.step));
  }

  async function fillFile(box: HTMLElement, path: string, step: LanternGuideStep, ticket: number) {
    const section = el('section', 'lt-guide-file');
    const name = button('lt-guide-file-name', '', { guideOpen: path });
    name.innerHTML = fileLabelHtml(path);
    name.setAttribute('aria-label', `Open ${path}`);
    const body = el('div', 'rv-code lt-code-body lt-guide-code');
    section.append(name, body);
    box.append(section);
    const res = await (opts.readDiff as ReadDiff)((pr as LanternPr).id, path).catch(() => null);
    if (ticket !== tickets) return;
    if (!res?.ok) return void body.replaceChildren(notice(`Diff not available: ${res?.reason || 'could not read it'}.`));
    if (res.binary) return void body.replaceChildren(notice('Binary file: no text diff to show.'));
    const rows = selectRows(parseDiffRows(res.diff), refsOf(step.hunks, path));
    if (!rows.length) return void body.replaceChildren(notice('This step names no line changes in this file.'));
    const lexical = await diffLexicalLines(rows, langFor(path));
    if (ticket !== tickets) return;
    body.replaceChildren(renderDiff(rows, lexical, planDiff(rows, true), {}, semanticLanguageFor(path)));
  }

  async function fillHunks(box: HTMLElement, index: number) {
    box.dataset.loaded = 'true';
    const step = guide?.steps[index];
    if (!step) return;
    if (!opts.readDiff) return void box.append(notice(NO_READER_TEXT));
    const ticket = tickets;
    await Promise.all(pathsOf(step.hunks).map((path) => fillFile(box, path, step, ticket)));
  }

  function railItem(step: LanternGuideStep, index: number) {
    const item = el('li', 'lt-guide-rail-item');
    item.dataset.step = String(index);
    const check = el('input', 'lt-guide-check');
    check.type = 'checkbox';
    check.dataset.guideDone = String(index);
    check.setAttribute('aria-label', `Mark step ${index + 1} done: ${step.title}`);
    const go = button('lt-guide-go', step.title, { guideGo: String(index) });
    item.append(check, go);
    return item;
  }

  function stepItem(step: LanternGuideStep, index: number) {
    const item = el('li', 'lt-guide-step');
    item.dataset.step = String(index);
    item.dataset.careful = String(step.careful);
    const where = `lt-guide-body-${index}`;
    const fold = button('lt-guide-fold', '', { guideFold: String(index) });
    fold.setAttribute('aria-controls', where);
    const files = pathsOf(step.hunks).length;
    fold.append(el('span', 'lt-guide-num', String(index + 1)), el('span', 'lt-guide-title', step.title), el('span', 'lt-guide-meta', `${step.careful ? 'careful' : 'skim'} · ${files} file${files === 1 ? '' : 's'}`));
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
    const hunks = el('div', 'lt-guide-hunks');
    hunks.dataset.step = String(index);
    body.append(hunks);
    item.append(fold, body);
    return item;
  }

  function paint(next: LanternGuide, id: string) {
    tickets += 1;
    const head = el('header', 'lt-guide-head');
    head.append(el('p', 'lt-guide-summary', next.summary));
    const risk = el('p', 'lt-guide-risk');
    risk.dataset.level = next.risk.level;
    risk.append(el('b', 'lt-guide-level', RISK_LABEL[next.risk.level]), document.createTextNode(` ${next.risk.why}`));
    head.append(risk);
    const rail = el('ol', 'lt-guide-rail');
    rail.setAttribute('aria-label', 'Steps');
    rail.append(...next.steps.map(railItem));
    const steps = el('ol', 'lt-guide-steps');
    steps.append(...next.steps.map(stepItem));
    const nav = el('nav', 'lt-guide-nav');
    nav.append(rail);
    const body = el('div', 'lt-guide-body');
    body.append(nav, steps);
    root.replaceChildren(head, body);
    root.setAttribute('aria-label', `Guide of pull request #${id}`);
  }

  function go(index: number, scroll = true) {
    if (!guide || index < 0 || index >= guide.steps.length) return;
    state.current = index;
    sync();
    if (scroll) stepEl(index)?.scrollIntoView?.({ block: 'nearest' });
  }

  root.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const open = target.closest<HTMLElement>('[data-guide-open]');
    if (open) return opts.open(open.dataset.guideOpen ?? '');
    const fold = target.closest<HTMLElement>('[data-guide-fold]');
    const pseudo = target.closest<HTMLElement>('[data-guide-pseudo]');
    const jump = target.closest<HTMLElement>('[data-guide-go]');
    if (fold) flip(state.toggled, Number(fold.dataset.guideFold));
    if (pseudo) flip(state.pseudo, Number(pseudo.dataset.guidePseudo));
    const picked = fold?.dataset.guideFold ?? pseudo?.dataset.guidePseudo ?? jump?.dataset.guideGo;
    if (picked !== undefined) go(Number(picked), !!jump);
  });

  root.addEventListener('change', (ev) => {
    const check = (ev.target as Element).closest<HTMLInputElement>('[data-guide-done]');
    if (!check) return;
    const index = Number(check.dataset.guideDone);
    if (check.checked) state.done.add(index);
    else state.done.delete(index);
    sync();
  });

  return {
    el: root,
    show(next) {
      const nextGuide = guideOf(next);
      if (!next || !nextGuide) {
        pr = undefined;
        guide = null;
        root.replaceChildren();
        return;
      }
      if (pr?.id === next.id && guide === nextGuide) return;
      pr = next;
      guide = nextGuide;
      state = states.get(next.id) ?? newState();
      state.current = Math.min(state.current, nextGuide.steps.length - 1);
      states.set(next.id, state);
      paint(nextGuide, next.id);
      sync();
    },
    move: (delta) => go(state.current + delta),
    handleKey(ev) {
      if (!guide || ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return false;
      if ((ev.target as Element | null)?.closest?.(KEEPS_KEYS)) return false;
      const delta = ev.key.toLowerCase() === 'j' ? 1 : ev.key.toLowerCase() === 'k' ? -1 : 0;
      if (!delta) return false;
      ev.preventDefault();
      go(state.current + delta);
      return true;
    },
    dispose() {
      tickets += 1;
      root.replaceChildren();
    },
  };
}

export { createGuideView };
export type { GuideView, GuideViewOptions };
