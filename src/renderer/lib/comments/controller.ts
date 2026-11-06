import { copyTexts, fixPresets } from '../../../shared/lang/fix-requests';
import type { IntentId } from '../../../shared/lang/fix-requests';
import { formatFixRequests, sortFixItems } from '../fixrequests/format';
import type { FixPrInfo } from '../fixrequests/format';
import { browserChoiceBackend, intentOf } from '../fixrequests/intent';
import type { CopyChoice } from '../fixrequests/intent';
import { hasRange } from '../fixrequests/model';
import type { FixItem } from '../fixrequests/model';
import { browserFixBackend, createFixStore } from '../fixrequests/store';
import type { FixBackend, FixStore } from '../fixrequests/store';
import { createCommentBox } from './box';
import { createCardPool, linesLabel, whereLabel } from './card';
import type { CardPool } from './card';
import { createSelectionButton } from './float';
import { createGutter } from './gutter';
import type { Gutter } from './gutter';
import { createCommentLayer, reconcile } from './layer';
import type { CommentLayer } from './layer';
import { createViewNote } from './note';
import type { ViewMode, ViewNote } from './note';
import { textOfLines } from './rows';
import type { LineSpan } from './rows';
import { countLabel, createCommentTools } from './tools';

interface CommentTarget {
  pr: FixPrInfo;
  path: string;
  order: readonly string[];
}

interface CommentsOptions {
  project?: string;
  language?: () => string;
  backend?: (project: string | undefined, pr: string) => FixBackend;
  copy?: (text: string) => Promise<void>;
  openFile?: (path: string) => void;
}

interface CommentsHost {
  area: HTMLElement;
  fileHost: HTMLElement;
  bodies: Partial<Record<ViewMode, HTMLElement>>;
  mode(): ViewMode | null;
  showMode(mode: ViewMode): void;
}

interface ReviewComments {
  tools: HTMLElement;
  setTarget(target: CommentTarget | null): void;
  modeChanged(): void;
  dispose(): void;
}

type Open = { kind: 'new'; span: LineSpan | null } | { kind: 'edit'; id: string };

const FLASH_MS = 1600;
const NOT_SHOWN = 'None of these lines is shown in the pane.';
const MODES: readonly ViewMode[] = ['file', 'diff'];

function createReviewComments(options: CommentsOptions, host: CommentsHost): ReviewComments {
  const stores = new Map<string, FixStore>();
  const collapsed = new Set<string>();
  const layers: Partial<Record<ViewMode, CommentLayer>> = {};
  const gutters: Partial<Record<ViewMode, Gutter>> = {};
  const pools: Record<ViewMode | 'whole', CardPool> = { file: pool(), diff: pool(), whole: pool() };
  const notes: Partial<Record<ViewMode, ViewNote>> = {};
  const makeBackend = options.backend ?? browserFixBackend;
  const writeClipboard = options.copy ?? ((text: string) => navigator.clipboard.writeText(text));
  const choiceBackend = browserChoiceBackend(options.project);
  let copyChoice: CopyChoice = choiceBackend.load();
  let target: CommentTarget | null = null;
  let store: FixStore | null = null;
  let storeFor = '';
  let unsubscribe: (() => void) | null = null;
  let open: Open | null = null;
  let preview: LineSpan | null = null;
  let jumpTo: string | null = null;
  let jumpSwitched = false;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const box = createCommentBox({ onSave: save, onCancel: () => closeBox(true) });
  const tools = createCommentTools({ onFile: () => startNew(null), onCopy: () => void copyAll(), onChoice: chooseCopyIntent, onOpen: openComment });
  const float = createSelectionButton({ host: host.area, body: () => activeBody(), enabled: () => !open, onComment: startNew });
  host.area.append(float.el);
  host.fileHost.hidden = true;

  function pool() {
    return createCardPool({ onEdit: startEdit, onDelete: removeItem }, collapsed);
  }

  const activeMode = () => host.mode();
  const activeBody = () => (activeMode() ? (host.bodies[activeMode() as ViewMode] ?? null) : null);
  const itemsHere = () => (store && target ? sortFixItems(store.items(), [target.path]).filter((item) => item.path === target?.path) : []);
  const ranged = () => itemsHere().filter(hasRange);
  const whole = () => itemsHere().filter((item) => !hasRange(item));
  const find = (id: string) => store?.items().find((item) => item.id === id);
  const say = (text: string) => tools.say(text);

  function openSpan(): LineSpan | null {
    if (!open) return null;
    if (open.kind === 'new') return open.span;
    const item = find(open.id);
    return item && hasRange(item) ? { start: item.start, end: item.end } : null;
  }

  function boxPlacement(mode: ViewMode) {
    const span = openSpan();
    if (!open || !span || mode !== activeMode()) return null;
    return { el: box.el, line: span.end, replaces: open.kind === 'edit' ? open.id : undefined };
  }

  function paintWhole() {
    const editing = open?.kind === 'edit' ? open.id : null;
    const nodes = whole().map((item) => (item.id === editing ? box.el : pools.whole.card(item)));
    if (open?.kind === 'new' && !open.span) nodes.push(box.el);
    reconcile(host.fileHost, nodes);
    host.fileHost.hidden = nodes.length === 0;
  }

  function paintTools() {
    tools.paint({ items: store?.items() ?? [], order: target?.order ?? [], canComment: !!target, choice: copyChoice });
  }

  const followedIntent = () => intentOf({}, copyChoice);

  function chooseCopyIntent(choice: CopyChoice) {
    copyChoice = choice;
    choiceBackend.save(choice);
    paintTools();
  }

  function paintAll() {
    for (const layer of Object.values(layers)) layer.sync();
    paintWhole();
    paintTools();
    float.update();
    keepBoxFocus();
    const ids = new Set(store?.items().map((item) => item.id));
    for (const pooled of Object.values(pools)) pooled.keep(ids);
  }

  function keepBoxFocus() {
    if (box.wantsFocus() && box.isOpen() && box.el.isConnected && !box.el.contains(document.activeElement)) box.focus(false);
  }

  function previewSpan(span: LineSpan | null) {
    preview = span;
    for (const layer of Object.values(layers)) layer.paintHighlight();
  }

  function startNew(span: LineSpan | null) {
    if (!target) return;
    closeBox(false);
    open = { kind: 'new', span };
    preview = null;
    box.open({ heading: span ? `Comment on ${linesLabel(span.start, span.end).toLowerCase()}` : 'Comment on this file', submit: 'Save', comment: '', preset: '', fallback: followedIntent(), presets: fixPresets(options.language?.()) });
    paintAll();
    focusBox();
  }

  function startEdit(item: FixItem) {
    closeBox(false);
    open = { kind: 'edit', id: item.id };
    box.open({ heading: `Edit the comment on ${whereLabel(item).toLowerCase()}`, submit: 'Save', comment: item.comment, preset: item.preset ?? '', intent: item.intent, fallback: followedIntent(), presets: fixPresets(options.language?.()) });
    paintAll();
    focusBox();
  }

  function focusBox() {
    box.focus();
    box.el.scrollIntoView?.({ block: 'nearest' });
  }

  function restoreFocus(span: LineSpan | null, editId?: string) {
    const mode = activeMode();
    const card = editId ? (pools.whole.edit(editId) ?? (mode ? pools[mode].edit(editId) : null)) : null;
    const gutter = mode ? gutters[mode] : undefined;
    if (card) card.focus();
    else if (span && gutter) gutter.focusLine(span.end);
    else tools.fileButton.focus();
  }

  function closeBox(restore: boolean) {
    const was = open;
    const span = openSpan();
    open = null;
    preview = null;
    box.close();
    paintAll();
    if (restore && was) restoreFocus(span, was.kind === 'edit' ? was.id : undefined);
  }

  function save(result: { comment: string; preset: string; intent?: IntentId }) {
    if (!store || !target || !open) return;
    const preset = result.preset || undefined;
    const { intent } = result;
    if (open.kind === 'edit') {
      store.update(open.id, { preset, intent, comment: result.comment });
      say('Comment saved');
      return closeBox(true);
    }
    const span = open.span;
    const code = span ? textOfLines(activeBody(), span) : '';
    if (span && !code.trim()) return box.fail(NOT_SHOWN);
    store.add({ path: target.path, ...(span ? { start: span.start, end: span.end, code } : {}), preset, intent, comment: result.comment });
    say('Comment added');
    closeBox(true);
  }

  function removeItem(item: FixItem) {
    store?.remove(item.id);
    say('Comment deleted');
    restoreFocus(hasRange(item) ? { start: item.start, end: item.end } : null);
  }

  async function copyAll() {
    if (!store || !target || !store.items().length) return;
    try {
      await writeClipboard(formatFixRequests(target.pr, store.items(), { order: target.order, choice: copyChoice, texts: copyTexts(options.language?.()) }));
    } catch {
      return tools.copied(false);
    }
    tools.copied(true);
    say(`${countLabel(store.items().length)} copied`);
  }

  function flash(card: HTMLElement) {
    card.scrollIntoView?.({ block: 'center' });
    card.classList.add('lt-cm-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => card.classList.remove('lt-cm-flash'), FLASH_MS);
  }

  function resolveJump() {
    const item = jumpTo ? find(jumpTo) : undefined;
    const mode = activeMode();
    if (!item || item.path !== target?.path || !mode) return;
    if (!hasRange(item)) {
      jumpTo = null;
      return flash(pools.whole.card(item));
    }
    const layer = layers[mode];
    if (layer?.isShown(item.id)) {
      jumpTo = null;
      return flash(pools[mode].card(item));
    }
    if (!layer?.loaded()) return;
    const other = MODES.find((each) => each !== mode && host.bodies[each]);
    const retry = other && !jumpSwitched;
    jumpSwitched = true;
    if (retry) host.showMode(other);
    else jumpTo = null;
  }

  function startJump(id: string) {
    jumpTo = id;
    jumpSwitched = false;
  }

  function openComment(item: FixItem) {
    startJump(item.id);
    if (item.path !== target?.path) options.openFile?.(item.path);
    resolveJump();
  }

  function bind(pr: string) {
    unsubscribe?.();
    let each = stores.get(pr);
    if (!each) {
      each = createFixStore(makeBackend(options.project, pr));
      stores.set(pr, each);
    }
    store = each;
    storeFor = pr;
    unsubscribe = each.onChange(paintAll);
  }

  for (const mode of MODES) {
    const body = host.bodies[mode];
    if (!body) continue;
    const other = MODES.find((each) => each !== mode && host.bodies[each]) ?? null;
    const note = createViewNote((showMode, first) => {
      startJump(first.id);
      jumpSwitched = true;
      host.showMode(showMode);
    });
    notes[mode] = note;
    gutters[mode] = createGutter({ body, onPreview: (span) => previewSpan(span ?? openSpan()), onComment: startNew });
    layers[mode] = createCommentLayer(body, {
      items: ranged,
      card: (item) => pools[mode].card(item),
      highlight: () => preview ?? openSpan(),
      box: () => boxPlacement(mode),
      note: (hidden) => note.paint(hidden, mode === activeMode() ? other : null),
      synced: () => {
        gutters[mode]?.ensure();
        float.update();
        keepBoxFocus();
        resolveJump();
      },
    });
  }

  return {
    tools: tools.el,
    setTarget(next) {
      const moved = target?.path !== next?.path || target?.pr.id !== next?.pr.id;
      target = next;
      if (next && storeFor !== next.pr.id) bind(next.pr.id);
      if (!next) {
        unsubscribe?.();
        unsubscribe = null;
        store = null;
        storeFor = '';
      }
      if (moved && jumpTo && (!next || find(jumpTo)?.path !== next.path)) jumpTo = null;
      if (moved && open) {
        open = null;
        box.close();
      }
      if (moved) preview = null;
      paintAll();
      resolveJump();
    },
    modeChanged() {
      if (open && openSpan()) {
        open = null;
        box.close();
      }
      paintAll();
      resolveJump();
    },
    dispose() {
      unsubscribe?.();
      clearTimeout(flashTimer);
      for (const layer of Object.values(layers)) layer.dispose();
      for (const gutter of Object.values(gutters)) gutter.dispose();
      float.dispose();
      tools.dispose();
    },
  };
}

export { createReviewComments };
export type { CommentTarget, CommentsHost, CommentsOptions, ReviewComments };
