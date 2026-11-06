import { mountPopover } from '@renderer/popover';
import { sortFixItems } from '../fixrequests/format';
import { COPY_CHOICES, PER_COMMENT, intentLabel, isCopyChoice } from '../fixrequests/intent';
import type { CopyChoice } from '../fixrequests/intent';
import type { FixItem } from '../fixrequests/model';
import { el } from '../util';
import { whereLabel } from './card';

interface ToolsState {
  items: readonly FixItem[];
  order: readonly string[];
  canComment: boolean;
  choice: CopyChoice;
}

interface ToolsHandlers {
  onFile(): void;
  onCopy(): void;
  onChoice(choice: CopyChoice): void;
  onOpen(item: FixItem): void;
}

interface CommentTools {
  el: HTMLElement;
  fileButton: HTMLButtonElement;
  paint(state: ToolsState): void;
  say(text: string): void;
  copied(ok: boolean): void;
  closePopover(): boolean;
  dispose(): void;
}

const TEXT = {
  file: 'Comment',
  fileTitle: 'Comment on this whole file',
  fileLabel: 'Comment on this file',
  list: 'Comments',
  copy: 'Copy all',
  choice: 'Copy all, default intent',
  choiceTitle: 'The intent copied for comments that have none of their own',
  perComment: 'Per comment',
  copied: 'Copied',
  popover: 'Comments in this pull request',
  empty: 'No comments yet. Select code and press Comment, or use the + in the gutter.',
  copyFailed: 'The comments could not be copied.',
} as const;
const COPIED_MS = 1500;

let toolsCount = 0;

function pill(act: string, text: string) {
  const b = el('button', 'lt-cm-pill', text);
  b.type = 'button';
  b.dataset.cmTool = act;
  return b;
}

function choiceText(choice: CopyChoice) {
  return choice === PER_COMMENT ? TEXT.perComment : `Default: ${intentLabel(choice)}`;
}

function choiceSelect() {
  const select = el('select', 'lt-cm-choice');
  select.setAttribute('aria-label', TEXT.choice);
  select.dataset.tip = TEXT.choiceTitle;
  for (const choice of COPY_CHOICES) {
    const option = el('option', '', choiceText(choice));
    option.value = choice;
    select.append(option);
  }
  return select;
}

function countLabel(count: number) {
  return `${count} ${count === 1 ? 'comment' : 'comments'}`;
}

function groupByPath(items: readonly FixItem[]) {
  const groups: { path: string; items: FixItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last?.path === item.path) last.items.push(item);
    else groups.push({ path: item.path, items: [item] });
  }
  return groups;
}

function popItem(item: FixItem) {
  const b = el('button', 'lt-cm-pop-item');
  b.type = 'button';
  b.dataset.cmId = item.id;
  b.dataset.tip = item.comment;
  b.append(el('span', 'lt-cm-pop-where', whereLabel(item)), el('span', 'lt-cm-pop-text', item.comment));
  return b;
}

function popGroup(group: { path: string; items: FixItem[] }) {
  const section = el('section', 'lt-cm-pop-group');
  const path = el('p', 'lt-cm-pop-path', group.path);
  path.dataset.tip = group.path;
  const list = el('ul', 'lt-cm-pop-list');
  for (const item of group.items) {
    const row = el('li', 'lt-cm-pop-row');
    row.append(popItem(item));
    list.append(row);
  }
  section.append(path, list);
  return section;
}

function createCommentTools(handlers: ToolsHandlers): CommentTools {
  const root = el('div', 'lt-cm-tools');
  const file = pill('file', TEXT.file);
  file.dataset.tip = TEXT.fileTitle;
  file.setAttribute('aria-label', TEXT.fileLabel);
  const list = pill('list', TEXT.list);
  const badge = el('span', 'lt-cm-count');
  list.append(badge);
  list.setAttribute('aria-haspopup', 'dialog');
  const copy = pill('copy', TEXT.copy);
  const choice = choiceSelect();
  const pop = el('div', 'lt-cm-pop');
  pop.id = `lt-cm-pop-${++toolsCount}`;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', TEXT.popover);
  pop.tabIndex = -1;
  const live = el('span', 'lt-cm-announce');
  live.setAttribute('role', 'status');
  const copyGroup = el('span', 'lt-cm-copy-group');
  copyGroup.append(copy, choice);
  root.append(file, list, copyGroup, pop, live);

  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let painted = '';
  let shown: readonly FixItem[] = [];

  const popover = mountPopover(list, pop, {
    placement: 'bottom-stretch',
    anchor: root,
    inside: root,
    focus: () => pop.querySelector<HTMLElement>('.lt-cm-pop-item') ?? pop,
  });

  function close(refocus: boolean) {
    if (!popover.isOpen()) return false;
    popover.close(refocus);
    return true;
  }

  function paintPopover(items: readonly FixItem[], order: readonly string[]) {
    const sorted = sortFixItems(items, order);
    const key = JSON.stringify(sorted.map((item) => [item.id, item.path, item.start, item.end, item.comment]));
    if (key === painted) return;
    painted = key;
    pop.replaceChildren(...(sorted.length ? groupByPath(sorted).map(popGroup) : [el('p', 'lt-cm-pop-empty', TEXT.empty)]));
  }

  file.addEventListener('click', () => handlers.onFile());
  copy.addEventListener('click', () => handlers.onCopy());
  choice.addEventListener('change', () => {
    if (isCopyChoice(choice.value)) handlers.onChoice(choice.value);
  });
  pop.addEventListener('click', (ev) => {
    const target = (ev.target as Element).closest<HTMLElement>('.lt-cm-pop-item');
    const chosen = shown.find((each) => each.id === target?.dataset.cmId);
    if (!chosen) return;
    close(false);
    handlers.onOpen(chosen);
  });

  return {
    el: root,
    fileButton: file,
    paint(state) {
      shown = state.items;
      badge.textContent = String(state.items.length);
      list.setAttribute('aria-label', `${TEXT.list}, ${countLabel(state.items.length)}`);
      copy.disabled = state.items.length === 0;
      choice.value = state.choice;
      file.disabled = !state.canComment;
      paintPopover(state.items, state.order);
    },
    say(text) {
      live.textContent = text;
    },
    copied(ok) {
      if (!ok) {
        live.textContent = TEXT.copyFailed;
        return;
      }
      copy.textContent = TEXT.copied;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copy.textContent = TEXT.copy;
      }, COPIED_MS);
    },
    closePopover: () => close(true),
    dispose() {
      clearTimeout(copyTimer);
      popover.dispose();
    },
  };
}

export { countLabel, createCommentTools };
export type { CommentTools, ToolsHandlers, ToolsState };
