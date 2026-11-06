import { intentLabel } from '../fixrequests/intent';
import { hasRange } from '../fixrequests/model';
import type { FixItem } from '../fixrequests/model';
import { el } from '../util';

interface CardHandlers {
  onEdit(item: FixItem): void;
  onDelete(item: FixItem): void;
}

interface CardPool {
  card(item: FixItem): HTMLElement;
  edit(id: string): HTMLButtonElement | null;
  keep(ids: ReadonlySet<string>): void;
}

function linesLabel(start: number, end: number) {
  return start === end ? `Line ${start}` : `Lines ${start}–${end}`;
}

function whereLabel(item: FixItem) {
  return hasRange(item) ? linesLabel(item.start, item.end) : 'File';
}

function button(act: string, text: string, label: string) {
  const b = el('button', `lt-cm-btn lt-cm-card-${act}`, text);
  b.type = 'button';
  b.dataset.cmAct = act;
  b.setAttribute('aria-label', label);
  return b;
}

function signature(item: FixItem) {
  return `${item.start ?? ''}|${item.end ?? ''}|${item.intent ?? ''}|${item.comment}`;
}

function createCardPool(handlers: CardHandlers, collapsed: Set<string>): CardPool {
  const cards = new Map<string, HTMLElement>();
  const items = new Map<string, FixItem>();

  function paintFold(card: HTMLElement, id: string) {
    const folded = collapsed.has(id);
    const fold = card.querySelector<HTMLButtonElement>('.lt-cm-fold');
    const text = card.querySelector<HTMLElement>('.lt-cm-card-text');
    card.classList.toggle('lt-cm-collapsed', folded);
    fold?.setAttribute('aria-expanded', String(!folded));
    fold?.setAttribute('aria-label', `${folded ? 'Expand' : 'Collapse'} the comment on ${whereLabel(items.get(id) as FixItem).toLowerCase()}`);
    if (!text) return;
    if (folded) text.dataset.tip = text.textContent ?? '';
    else delete text.dataset.tip;
  }

  function fill(card: HTMLElement, item: FixItem) {
    const where = whereLabel(item);
    const fold = el('button', 'lt-cm-fold');
    fold.type = 'button';
    fold.dataset.cmAct = 'fold';
    const label = el('span', 'lt-cm-where', where);
    const actions = el('span', 'lt-cm-card-actions');
    actions.append(button('edit', 'Edit', `Edit the comment on ${where.toLowerCase()}`), button('delete', 'Delete', `Delete the comment on ${where.toLowerCase()}`));
    const head = el('div', 'lt-cm-card-head');
    head.append(fold, label);
    if (item.intent) head.append(el('span', 'lt-cm-tag', intentLabel(item.intent)));
    head.append(actions);
    card.replaceChildren(head, el('p', 'lt-cm-card-text', item.comment));
    card.setAttribute('aria-label', `Comment on ${where.toLowerCase()}`);
  }

  function build(item: FixItem) {
    const card = el('article', 'lt-cm-card');
    card.dataset.cmId = item.id;
    card.addEventListener('click', (ev) => {
      const target = (ev.target as Element).closest<HTMLElement>('[data-cm-act]');
      const current = items.get(item.id);
      if (!target || !current) return;
      if (target.dataset.cmAct === 'edit') handlers.onEdit(current);
      else if (target.dataset.cmAct === 'delete') handlers.onDelete(current);
      else if (target.dataset.cmAct === 'fold') {
        if (collapsed.has(item.id)) collapsed.delete(item.id);
        else collapsed.add(item.id);
        paintFold(card, item.id);
      }
    });
    return card;
  }

  return {
    card(item) {
      const known = items.get(item.id);
      items.set(item.id, item);
      let card = cards.get(item.id);
      if (!card) {
        card = build(item);
        cards.set(item.id, card);
      }
      if (!known || signature(known) !== signature(item)) fill(card, item);
      paintFold(card, item.id);
      return card;
    },
    edit: (id) => cards.get(id)?.querySelector<HTMLButtonElement>('.lt-cm-card-edit') ?? null,
    keep(ids) {
      for (const id of [...cards.keys()]) {
        if (ids.has(id)) continue;
        cards.delete(id);
        items.delete(id);
      }
    },
  };
}

export { createCardPool, linesLabel, whereLabel };
export type { CardHandlers, CardPool };
