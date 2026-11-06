import { EXPLAINER_ENABLED, SECTION_HEADINGS, explanationPlainText, isPrExplanationStale } from '../../shared/pr-explain';
import type { PrExplainDone, PrExplainSavedResult, PrExplainSections, PrExplainStartResult, PrExplanation } from '../../shared/pr-explain';

interface PrExplainClient {
  saved(pr: string, path: string, head: string): Promise<PrExplainSavedResult>;
  start(pr: string, path: string): Promise<PrExplainStartResult>;
  cancel(pr: string, path: string): Promise<boolean>;
  onDone(cb: (done: PrExplainDone) => void): () => void;
}

interface ExplainTarget {
  pr: string;
  path: string;
  head: string;
}

interface ExplainOptions {
  enabled?: boolean;
  collapsed?: boolean;
  onCollapsed?(collapsed: boolean): void;
}

interface ExplainHub {
  row(target: ExplainTarget): HTMLElement;
  dispose(): void;
}

type Phase = 'idle' | 'running' | 'failed';

interface Slot {
  target: ExplainTarget;
  phase: Phase;
  explanation: PrExplanation | null;
  error: string;
  token: number;
  el: HTMLElement;
  announce: HTMLElement;
  toggle: HTMLButtonElement;
  state: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  text: HTMLElement;
  sections: HTMLElement;
  stale: HTMLElement;
  collapsed: boolean;
  enabled: boolean;
}

const LABEL = { explain: 'Explain more', regenerate: 'Regenerate', retry: 'Retry', cancel: 'Cancel', copy: 'Copy', copied: 'Copied', running: 'Explaining…', panel: 'Explanation', ready: 'Ready', failed: 'Failed', collapse: 'Collapse the explanation', expand: 'Expand the explanation' } as const;
const STALE_TEXT = 'From an earlier version of this PR';
const MAX_ERROR_CHARS = 200;
const COPIED_MS = 1500;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(act: string, label: string, title?: string) {
  const b = make('button', 'lt-explain-btn', label);
  b.type = 'button';
  b.dataset.explain = act;
  if (title) b.dataset.tip = title;
  return b;
}

function firstSentence(error: string) {
  const one = error.split(/(?<=[.!?])\s/)[0] ?? error;
  return one.length > MAX_ERROR_CHARS ? `${one.slice(0, MAX_ERROR_CHARS - 1)}…` : one;
}

let slotCount = 0;

function createSlot(target: ExplainTarget, collapsed: boolean, enabled: boolean): Slot {
  const el = make('div', 'lt-explain');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Explanation of this change');
  const announce = make('span', 'lt-explain-announce');
  announce.setAttribute('role', 'status');
  const bar = make('div', 'lt-explain-bar');
  const toggle = make('button', 'lt-explain-toggle', LABEL.panel);
  toggle.type = 'button';
  toggle.dataset.explainToggle = '';
  toggle.id = `lt-explain-toggle-${++slotCount}`;
  const state = make('span', 'lt-explain-state');
  const stale = make('span', 'lt-explain-stale', STALE_TEXT);
  bar.append(toggle, state, stale);
  const body = make('div', 'lt-explain-body');
  body.id = `lt-explain-body-${slotCount}`;
  toggle.setAttribute('aria-controls', body.id);
  const text = make('p', 'lt-explain-text');
  const sections = make('div', 'lt-explain-sections');
  const actions = make('div', 'lt-explain-actions');
  body.append(text, sections, actions);
  el.append(announce, bar, body);
  return { target, phase: 'idle', explanation: null, error: '', token: 0, el, announce, toggle, state, body, actions, text, sections, stale, collapsed, enabled };
}

function looksLikeCode(example: string) {
  return example.includes('\n') || /->|=>|→|[`={}()<>[\]]/.test(example);
}

function sectionRow(key: keyof PrExplainSections, heading: string, value: string) {
  const row = make('div', 'lt-explain-sec');
  row.dataset.section = key;
  const body = key === 'example' && looksLikeCode(value) ? make('pre', 'lt-explain-code', value) : make('p', 'lt-explain-sec-text', value);
  row.append(make('span', 'lt-explain-label', heading), body);
  return row;
}

function sectionRows(sections: PrExplainSections | undefined) {
  if (!sections) return [];
  return SECTION_HEADINGS.filter(([key]) => sections[key]).map(([key, heading]) => sectionRow(key, heading, sections[key]));
}

function plainTextOf(explanation: PrExplanation) {
  return explanation.sections ? explanationPlainText(explanation.sections) : explanation.text;
}

function stateText(slot: Slot) {
  if (slot.phase === 'running') return LABEL.running;
  if (slot.phase === 'failed') return LABEL.failed;
  return slot.explanation ? LABEL.ready : '';
}

function actionsFor(slot: Slot): HTMLElement[] {
  const { phase, explanation } = slot;
  if (!slot.enabled) return explanation ? [button('copy', LABEL.copy, 'Copy the explanation')] : [];
  if (phase === 'running') {
    const spin = make('i', 'lt-explain-spin');
    spin.setAttribute('aria-hidden', 'true');
    return [spin, make('span', 'lt-explain-status', LABEL.running), button('cancel', LABEL.cancel, 'Stop this run')];
  }
  const copy = explanation ? [button('copy', LABEL.copy, 'Copy the explanation')] : [];
  if (phase === 'failed') {
    const reason = make('span', 'lt-explain-error', firstSentence(slot.error));
    reason.dataset.tip = slot.error;
    reason.setAttribute('role', 'alert');
    return [reason, button('start', LABEL.retry, 'Ask again'), ...copy];
  }
  if (!explanation) return [button('start', LABEL.explain, 'Have a short agent explain this change in a few sentences')];
  return [button('start', LABEL.regenerate, 'Write a new explanation'), ...copy];
}

function announcement(slot: Slot) {
  if (slot.phase === 'running') return LABEL.running;
  if (slot.phase === 'failed') return `Explanation failed: ${firstSentence(slot.error)}`;
  return slot.explanation ? 'Explanation ready' : '';
}

function paint(slot: Slot) {
  const held = slot.actions.contains(document.activeElement);
  const { explanation } = slot;
  const rows = sectionRows(explanation?.sections);
  slot.text.hidden = !explanation || rows.length > 0;
  slot.text.textContent = explanation && !rows.length ? explanation.text : '';
  slot.sections.hidden = !rows.length;
  slot.sections.replaceChildren(...rows);
  slot.stale.hidden = !explanation?.stale;
  slot.state.textContent = stateText(slot);
  slot.el.hidden = !slot.enabled && !explanation;
  slot.el.classList.toggle('lt-explain-collapsed', slot.collapsed);
  slot.body.hidden = slot.collapsed;
  slot.toggle.setAttribute('aria-expanded', String(!slot.collapsed));
  slot.toggle.dataset.tip = slot.collapsed ? LABEL.expand : LABEL.collapse;
  slot.actions.replaceChildren(...actionsFor(slot));
  slot.announce.textContent = announcement(slot);
  if (held) (slot.actions.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
}

function createExplainHub(client: PrExplainClient, options: ExplainOptions = {}): ExplainHub {
  const slots = new Map<string, Slot>();
  let unsubscribe: (() => void) | undefined;
  let collapsed = !!options.collapsed;
  const enabled = options.enabled ?? EXPLAINER_ENABLED;

  function setCollapsed(next: boolean) {
    collapsed = next;
    options.onCollapsed?.(next);
    for (const slot of slots.values()) {
      slot.collapsed = next;
      paint(slot);
    }
  }

  function setExplanation(slot: Slot, explanation: PrExplanation | null) {
    slot.explanation = explanation ? { ...explanation, stale: isPrExplanationStale(explanation.head, slot.target.head) } : null;
  }

  function begin(slot: Slot) {
    if (!enabled || slot.phase === 'running') return;
    listen();
    const { pr, path } = slot.target;
    const token = ++slot.token;
    slot.phase = 'running';
    slot.error = '';
    paint(slot);
    client.start(pr, path).then(
      (res) => {
        if (slot.token !== token || res.ok) return;
        slot.phase = 'failed';
        slot.error = res.error;
        paint(slot);
      },
      (err: unknown) => {
        if (slot.token !== token) return;
        slot.phase = 'failed';
        slot.error = err instanceof Error ? err.message : 'The explanation could not be started.';
        paint(slot);
      },
    );
  }

  function stop(slot: Slot) {
    if (slot.phase !== 'running') return;
    slot.token += 1;
    slot.phase = 'idle';
    paint(slot);
    void client.cancel(slot.target.pr, slot.target.path).catch(() => false);
  }

  function copy(slot: Slot, btn: HTMLButtonElement) {
    const text = slot.explanation && plainTextOf(slot.explanation);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => {
        btn.textContent = LABEL.copied;
        setTimeout(() => {
          if (btn.isConnected) btn.textContent = LABEL.copy;
        }, COPIED_MS);
      },
      () => {},
    );
  }

  function onClick(slot: Slot, ev: MouseEvent) {
    if ((ev.target as Element).closest('button[data-explain-toggle]')) {
      setCollapsed(!collapsed);
      return;
    }
    const btn = (ev.target as Element).closest('button[data-explain]') as HTMLButtonElement | null;
    if (!btn) return;
    const act = btn.dataset.explain;
    if (act === 'start') begin(slot);
    else if (act === 'cancel') stop(slot);
    else if (act === 'copy') copy(slot, btn);
  }

  function finish(done: PrExplainDone) {
    if (!done.ok && done.cancelled) return;
    const slot = slots.get(`${done.pr}\n${done.path}`);
    if (!slot || slot.phase !== 'running') return;
    slot.token += 1;
    if (done.ok) {
      slot.phase = 'idle';
      setExplanation(slot, done.explanation);
    } else {
      slot.phase = 'failed';
      slot.error = done.error;
    }
    paint(slot);
  }

  function listen() {
    unsubscribe ??= client.onDone(finish);
  }

  function open(target: ExplainTarget) {
    const slot = createSlot(target, collapsed, enabled);
    slot.el.addEventListener('click', (ev) => onClick(slot, ev));
    slots.set(`${target.pr}\n${target.path}`, slot);
    paint(slot);
    client.saved(target.pr, target.path, target.head).then(
      (res) => {
        if (!res.ok || !res.explanation || slot.explanation) return;
        setExplanation(slot, res.explanation);
        paint(slot);
      },
      () => {},
    );
    return slot;
  }

  return {
    row(target) {
      const slot = slots.get(`${target.pr}\n${target.path}`) ?? open(target);
      if (slot.target.head !== target.head) {
        slot.target = target;
        setExplanation(slot, slot.explanation);
      }
      slot.collapsed = collapsed;
      paint(slot);
      return slot.el;
    },
    dispose: () => unsubscribe?.(),
  };
}

export { createExplainHub };
export type { ExplainHub, ExplainOptions, ExplainTarget, PrExplainClient };
