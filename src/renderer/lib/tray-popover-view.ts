import { msg, msgCount, type MessageKey } from '@shared/lang/messages';
import { keepActive, NONE, trayIntent } from '@shared/tray-keys';
import { trayActionId } from '@shared/tray-action';
import type { TrayModel, TrayRow, TraySection, TrayState, TrayTone } from '@shared/tray-model';
import BELL_ICON from '../assets/icons/tray-bell.svg';
import CLEAR_ICON from '../assets/icons/tray-clear.svg';
import FAILED_ICON from '../assets/icons/tray-failed.svg';
import FINISHED_ICON from '../assets/icons/tray-finished.svg';
import LANTERN_MARK from '../assets/icons/lantern-mark.svg';
import MORE_ICON from '../assets/icons/tray-more.svg';
import OPEN_ICON from '../assets/icons/tray-open.svg';
import PERMISSION_ICON from '../assets/icons/tray-permission.svg';
import QUIET_ICON from '../assets/icons/tray-quiet.svg';
import QUIT_ICON from '../assets/icons/tray-quit.svg';
import STOPPED_ICON from '../assets/icons/tray-stopped.svg';
import WAITING_ICON from '../assets/icons/tray-waiting.svg';
import WORKING_ICON from '../assets/icons/tray-working.svg';
import { el } from './util';
import { middleTruncate } from './overlay-cards';

type Bridge = Pick<Window['trayPopover'], 'resize' | 'close' | 'openProject' | 'run'>;

const TONE_ICON: Record<TrayTone, string> = {
  permission: PERMISSION_ICON,
  failed: FAILED_ICON,
  waiting: WAITING_ICON,
  working: WORKING_ICON,
  finished: FINISHED_ICON,
  stopped: STOPPED_ICON,
  quiet: QUIET_ICON,
};

const STATE_TEXT: Record<TrayState, MessageKey> = {
  permission: 'tray.state.permission',
  failed: 'tray.state.failed',
  idle: 'tray.state.idle',
  running: 'tray.state.running',
  done: 'tray.state.done',
  shell: 'tray.state.shell',
  stopped: 'tray.state.stopped',
  unknown: 'tray.state.unknown',
  unavailable: 'tray.state.unavailable',
  ended: 'tray.state.ended',
  open: 'tray.state.open',
};

const SECTION_TEXT: Record<TraySection, MessageKey> = {
  needs: 'tray.section.needs',
  working: 'tray.section.working',
  finished: 'tray.section.finished',
  other: 'tray.section.rest',
};

const MAX_TAIL_CHARS = 36;
const MORE_KEY = 'action:more';
const ACTIVE = 'is-active';

function icon(markup: string, className = 'glyph') {
  const span = el('span', className);
  span.innerHTML = markup;
  return span;
}

function item(key: string, className: string, onClick: () => void) {
  const button = el('button', `item ${className}`);
  button.type = 'button';
  button.dataset.key = key;
  button.addEventListener('click', onClick);
  return button;
}

export interface TrayPopoverView {
  open(model: TrayModel, maxHeight: number): void;
  update(model: TrayModel): void;
}

export function mountTrayPopover(root: HTMLElement, bridge: Bridge): TrayPopoverView {
  let model: TrayModel | null = null;
  let moreOpen = false;
  let active = NONE;

  root.setAttribute('aria-label', msg('tray.label'));

  const items = () => [...root.querySelectorAll<HTMLButtonElement>('button[data-key]')];
  const report = () => bridge.resize(root.getBoundingClientRect().height);

  function setActive(index: number, focus = true) {
    const all = items();
    for (const [at, node] of all.entries()) node.classList.toggle(ACTIVE, at === index);
    active = index;
    if (index === NONE) return;
    if (focus) all[index].focus({ preventScroll: true });
    all[index].scrollIntoView({ block: 'nearest' });
  }

  function rowButton(row: TrayRow) {
    const button = item(`project:${row.path}`, 'row', () => bridge.openProject(row.path));
    button.dataset.tone = row.tone;
    const label = msg(STATE_TEXT[row.state]);
    const names = el('span', 'names');
    names.append(el('span', 'name', row.name));
    if (row.tail) names.append(el('span', 'tail', middleTruncate(row.tail, MAX_TAIL_CHARS)));
    const state = el('span', 'state');
    state.append(el('span', 'label', label));
    if (row.count > 1) {
      state.append(el('span', 'n', String(row.count)));
      button.setAttribute('aria-label', [row.name, label, msgCount('tray.sessions', row.count), row.tail].filter(Boolean).join(', '));
    }
    button.append(icon(TONE_ICON[row.tone], 'mark'), names, state);
    return button;
  }

  function sections(next: TrayModel) {
    if (next.empty) {
      const empty = el('div', 'empty');
      empty.append(icon(LANTERN_MARK, 'empty-mark'), el('p', 'empty-title', msg('tray.emptyTitle')), el('p', 'empty-hint', msg('tray.emptyHint')));
      return [empty];
    }
    return next.sections.map((section) => {
      const group = el('section', 'group');
      group.dataset.section = section.id;
      const heading = el('h2', 'eyebrow');
      heading.id = `tray-section-${section.id}`;
      heading.append(el('span', '', msg(SECTION_TEXT[section.id])), el('span', 'count', String(section.rows.length)));
      group.setAttribute('aria-labelledby', heading.id);
      group.append(heading, ...section.rows.map(rowButton));
      return group;
    });
  }

  function footer(next: TrayModel) {
    const bar = el('footer', 'foot');
    const open = item('action:workspace', 'act primary', () => bridge.run(trayActionId({ type: 'workspace' })));
    open.append(icon(OPEN_ICON), el('span', '', msg('tray.openWorkspace')));
    bar.append(open);
    if (next.canClear) {
      const clear = item('action:clear', 'act', () => bridge.run(trayActionId({ type: 'clear' })));
      clear.append(icon(CLEAR_ICON), el('span', '', msg('tray.clearFinished')));
      bar.append(clear);
    }
    const more = item(MORE_KEY, 'act icon-only', toggleMore);
    more.setAttribute('aria-label', msg('tray.more'));
    more.setAttribute('aria-expanded', String(moreOpen));
    more.append(icon(MORE_ICON));
    bar.append(more);
    return bar;
  }

  function morePanel(next: TrayModel) {
    const panel = el('div', 'more');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', msg('tray.more'));
    if (next.tests.length) {
      panel.append(el('h2', 'eyebrow', msg('tray.testNotification')));
      for (const test of next.tests) {
        const button = item(`action:test:${test.kind}`, 'row test', () => bridge.run(trayActionId({ type: 'test', kind: test.kind })));
        button.dataset.kind = test.kind;
        button.append(icon(BELL_ICON, 'mark'), el('span', 'name', test.label));
        panel.append(button);
      }
    }
    const quit = item('action:quit', 'row quit', () => bridge.run(trayActionId({ type: 'quit' })));
    quit.append(icon(QUIT_ICON, 'mark'), el('span', 'name', msg('tray.quit')));
    panel.append(quit);
    return panel;
  }

  const summary = el('p', 'summary');
  summary.setAttribute('aria-live', 'polite');
  const head = el('header', 'head');
  const brand = el('div', 'brand');
  brand.append(icon(LANTERN_MARK, 'logo'), el('h1', 'title', msg('tray.title')));
  head.append(brand, summary);
  root.append(head);

  function updateSummary(next: TrayModel) {
    summary.replaceChildren();
    if (next.needsYou > 0) summary.append(el('span', 'pill', msgCount('tray.needsYou', next.needsYou)));
    else if (!next.empty) summary.append(el('span', 'pill quiet', msg('tray.quiet')));
  }

  function render(next: TrayModel) {
    const previousKey = items()[active]?.dataset.key ?? null;
    const hadFocus = root.contains(document.activeElement) && document.activeElement !== root;
    model = next;
    root.ownerDocument.body.dataset.tone = next.tone;
    const scroller = el('div', 'scroller');
    scroller.append(...sections(next));
    updateSummary(next);
    while (head.nextSibling) head.nextSibling.remove();
    root.append(scroller, footer(next), ...(moreOpen ? [morePanel(next)] : []));
    const keys = items().map((node) => node.dataset.key ?? '');
    const kept = keepActive(previousKey, keys, active);
    active = NONE;
    if (kept !== NONE) setActive(kept, hadFocus);
    report();
  }

  function toggleMore() {
    if (!model) return;
    moreOpen = !moreOpen;
    render(model);
    const keys = items().map((node) => node.dataset.key);
    setActive(keys.indexOf(MORE_KEY));
  }

  root.addEventListener('keydown', (event) => {
    const intent = trayIntent({ key: event.key, shift: event.shiftKey }, active, items().length);
    if (!intent) return;
    event.preventDefault();
    root.dataset.input = 'key';
    if (intent.kind === 'move') setActive(intent.to);
    else if (intent.kind === 'activate') items()[active]?.click();
    else if (moreOpen && model) toggleMore();
    else bridge.close();
  });
  root.addEventListener('pointermove', (event) => {
    root.dataset.input = 'pointer';
    const target = (event.target as Element).closest<HTMLButtonElement>('button[data-key]');
    if (target && items().indexOf(target) !== active) setActive(items().indexOf(target));
  });
  root.addEventListener('focusin', (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button[data-key]');
    if (target && items().indexOf(target) !== active) setActive(items().indexOf(target), false);
  });

  return {
    open(next, maxHeight) {
      moreOpen = false;
      active = NONE;
      root.style.setProperty('--max-h', `${maxHeight}px`);
      render(next);
      root.focus({ preventScroll: true });
    },
    update: render,
  };
}
