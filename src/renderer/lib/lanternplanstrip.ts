import { mountPopover, rovingFocus } from '@renderer/popover';
import type { LanternPlanView } from '../../main/lantern-plan-view-types';
import { VIEW, say } from '../../shared/lantern-plan-messages';
import { esc } from './lanternctx';

interface PlanStrip {
  sync(plans: readonly LanternPlanView[], selected: string | null): void;
}

interface ListTexts {
  label: string;
  tip: string;
  heading: string;
}

const MAX_CHIPS = 5;

const isDone = (plan: LanternPlanView) => plan.total > 0 && plan.finished === plan.total;

function chipHtml(plan: LanternPlanView, on: boolean) {
  const state = say(plan.lifecycle === 'approved' ? VIEW.STATE_APPROVED : plan.lifecycle === 'stale' ? VIEW.STATE_STALE : VIEW.STATE_DRAFT);
  const name = plan.title || plan.slug;
  const title = say(VIEW.CHIP_TITLE, { title: name, state, finished: plan.finished, total: plan.total });
  const progress = plan.total ? `<em>${esc(say(VIEW.CHIP_PROGRESS, { finished: plan.finished, total: plan.total }))}</em>` : '';
  return `<button class="pl-chip pl-${plan.lifecycle}" data-plan="${esc(plan.slug)}" aria-pressed="${on}" data-tip="${esc(title)}"><span class="pl-chip-name">${esc(name)}</span><span class="pl-state pl-${plan.lifecycle}">${esc(state)}</span>${progress}</button>`;
}

function mountPlanList(kind: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `pl-listbtn pl-list-${kind}`;
  button.hidden = true;
  const pop = document.createElement('div');
  pop.className = `pl-listpop pl-list-${kind}-pop`;
  const popover = mountPopover(button, pop, {
    placement: 'bottom-start',
    onOpen: () => pop.setAttribute('role', 'dialog'),
    onClose: () => pop.removeAttribute('role'),
    focus: () => pop.querySelector<HTMLElement>('button[data-plan]'),
  });
  rovingFocus(pop, () => [...pop.querySelectorAll<HTMLElement>('button[data-plan]')]);

  return {
    button,
    pop,
    popover,
    fill(plans: readonly LanternPlanView[], selected: string | null, texts: ListTexts) {
      button.hidden = plans.length === 0;
      if (!plans.length) popover.close(false);
      button.textContent = texts.label;
      button.dataset.tip = texts.tip;
      button.setAttribute('aria-pressed', String(plans.some((plan) => plan.slug === selected)));
      pop.setAttribute('aria-label', texts.heading);
      pop.innerHTML = plans.map((plan) => chipHtml(plan, plan.slug === selected)).join('');
    },
    clear() {
      popover.close(false);
      button.hidden = true;
      pop.textContent = '';
    },
  };
}

function mountPlanStrip(el: HTMLElement, onSelect: (slug: string) => void): PlanStrip {
  const label = document.createElement('span');
  label.className = 'pr-label';
  const chips = document.createElement('div');
  chips.className = 'pr-chips';
  const more = mountPlanList('more');
  const done = mountPlanList('done');
  const lists = [more, done];
  el.replaceChildren(label, chips, more.button, more.pop, done.button, done.pop);

  el.addEventListener('click', (ev) => {
    const chip = (ev.target as Element).closest('button[data-plan]');
    if (!chip) return;
    lists.find((list) => list.pop.contains(chip))?.popover.close(true);
    onSelect(chip.getAttribute('data-plan') ?? '');
  });

  return {
    sync(plans, selected) {
      el.hidden = plans.length === 0;
      if (!plans.length) {
        label.textContent = '';
        chips.textContent = '';
        lists.forEach((list) => list.clear());
        return;
      }
      const focused = el.contains(document.activeElement) ? (document.activeElement as Element).getAttribute('data-plan') : null;
      const finished = plans.filter(isDone);
      const running = plans.filter((plan) => !isDone(plan));
      const rest = running.slice(MAX_CHIPS);
      label.textContent = say(VIEW.STRIP_LABEL);
      chips.innerHTML = running.slice(0, MAX_CHIPS).map((plan) => chipHtml(plan, plan.slug === selected)).join('');
      more.fill(rest, selected, {
        label: say(VIEW.MORE_LABEL, { count: rest.length }),
        tip: say(VIEW.MORE_TITLE, { count: rest.length }),
        heading: say(VIEW.MORE_HEADING),
      });
      done.fill(finished, selected, {
        label: say(VIEW.DONE_LABEL, { count: finished.length }),
        tip: say(VIEW.DONE_TITLE, { count: finished.length }),
        heading: say(VIEW.DONE_HEADING),
      });
      if (focused) [...el.querySelectorAll<HTMLElement>('button[data-plan]')].find((chip) => chip.getAttribute('data-plan') === focused)?.focus();
    },
  };
}

export { mountPlanStrip };
export type { PlanStrip };
