import type { FixItem } from '../fixrequests/model';
import { el } from '../util';

type ViewMode = 'file' | 'diff';

interface ViewNote {
  paint(hidden: readonly FixItem[], other: ViewMode | null): HTMLElement | null;
}

const MODE_NAME: Record<ViewMode, string> = { file: 'File', diff: 'Diff' };

function noteText(count: number) {
  return `${count} ${count === 1 ? 'comment' : 'comments'} not shown in this view`;
}

function write(target: HTMLElement, value: string) {
  if (target.textContent !== value) target.textContent = value;
}

function createViewNote(onShow: (mode: ViewMode, first: FixItem) => void): ViewNote {
  const root = el('div', 'lt-cm-note');
  const text = el('span', 'lt-cm-note-text');
  const show = el('button', 'lt-cm-btn lt-cm-note-show');
  show.type = 'button';
  root.append(text, show);
  let first: FixItem | null = null;
  let mode: ViewMode | null = null;

  show.addEventListener('click', () => {
    if (first && mode) onShow(mode, first);
  });

  return {
    paint(hidden, other) {
      if (!hidden.length) return null;
      first = hidden[0];
      mode = other;
      write(text, noteText(hidden.length));
      show.hidden = !other;
      if (other) {
        write(show, `Show in ${MODE_NAME[other]}`);
        show.setAttribute('aria-label', `Show ${noteText(hidden.length).replace(' not shown in this view', '')} in the ${MODE_NAME[other]} view`);
      }
      return root;
    },
  };
}

export { createViewNote, noteText };
export type { ViewMode, ViewNote };
