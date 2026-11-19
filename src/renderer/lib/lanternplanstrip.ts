import { mountPopover, rovingFocus } from '@renderer/popover';
import type { LanternPlanView } from '../../main/lantern-plan-view-types';
import { VIEW, say } from '../../shared/lantern-plan-messages';
import { esc } from './lanternctx';

interface PlanStrip {
  sync(plans: readonly LanternPlanView[], selected: string | null): void;
}

const isDone = (plan: LanternPlanView) => plan.total > 0 && plan.finished === plan.total;

function chipHtml(plan: LanternPlanView, on: boolean) {
  const state = say(plan.lifecycle === 'approved' ? VIEW.STATE_APPROVED : plan.lifecycle === 'stale' ? VIEW.STATE_STALE : VIEW.STATE_DRAFT);
  const name = plan.title || plan.slug;
  const title = say(VIEW.CHIP_TITLE, { title: name, state, finished: plan.finished, total: plan.total });
  const progress = plan.total ? `<em>${esc(say(VIEW.CHIP_PROGRESS, { finished: plan.finished, total: plan.total }))}</em>` : '';
  return `<button class="pl-chip pl-${plan.lifecycle}" data-plan="${esc(plan.slug)}" aria-pressed="${on}" data-tip="${esc(title)}"><span class="pl-chip-name">${esc(name)}</span><span class="pl-state pl-${plan.lifecycle}">${esc(state)}</span>${progress}</button>`;
}

function mountPlanStrip(el: HTMLElement, onSelect: (slug: string) => void): PlanStrip {
  const label = document.createElement('span');
  label.className = 'pr-label';
  const chips = document.createElement('div');
  chips.className = 'pr-chips';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'pl-done';
  done.hidden = true;
  const pop = document.createElement('div');
  pop.className = 'pl-done-pop';
  el.replaceChildren(label, chips, done, pop);

  const popover = mountPopover(done, pop, {
    placement: 'bottom-start',
    onOpen: () => pop.setAttribute('role', 'dialog'),
    onClose: () => pop.removeAttribute('role'),
    focus: () => pop.querySelector<HTMLElement>('button[data-plan]'),
  });
  rovingFocus(pop, () => [...pop.querySelectorAll<HTMLElement>('button[data-plan]')]);

  el.addEventListener('click', (ev) => {
    const chip = (ev.target as Element).closest('button[data-plan]');
    if (!chip) return;
    if (pop.contains(chip)) popover.close(true);
    onSelect(chip.getAttribute('data-plan') ?? '');
  });

  return {
    sync(plans, selected) {
      el.hidden = plans.length === 0;
      if (!plans.length) {
        popover.close(false);
        done.hidden = true;
        chips.textContent = '';
        pop.textContent = '';
        label.textContent = '';
        return;
      }
      const focused = el.contains(document.activeElement) ? (document.activeElement as Element).getAttribute('data-plan') : null;
      const finished = plans.filter(isDone);
      label.textContent = say(VIEW.STRIP_LABEL);
      chips.innerHTML = plans.filter((plan) => !isDone(plan)).map((plan) => chipHtml(plan, plan.slug === selected)).join('');
      done.hidden = finished.length === 0;
      if (!finished.length) popover.close(false);
      done.textContent = say(VIEW.DONE_LABEL, { count: finished.length });
      done.dataset.tip = say(VIEW.DONE_TITLE, { count: finished.length });
      pop.setAttribute('aria-label', say(VIEW.DONE_HEADING));
      pop.innerHTML = finished.map((plan) => chipHtml(plan, plan.slug === selected)).join('');
      if (focused) [...el.querySelectorAll<HTMLElement>('button[data-plan]')].find((chip) => chip.getAttribute('data-plan') === focused)?.focus();
    },
  };
}

export { mountPlanStrip };
export type { PlanStrip };
