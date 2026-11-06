import type { LanternPlanView } from '../../main/lantern-plan-view-types';
import { VIEW, say } from '../../shared/lantern-plan-messages';
import { esc } from './lanternctx';

interface PlanStrip {
  sync(plans: readonly LanternPlanView[], selected: string | null): void;
}

function chipHtml(plan: LanternPlanView, on: boolean) {
  const state = say(plan.lifecycle === 'approved' ? VIEW.STATE_APPROVED : plan.lifecycle === 'stale' ? VIEW.STATE_STALE : VIEW.STATE_DRAFT);
  const name = plan.title || plan.slug;
  const title = say(VIEW.CHIP_TITLE, { title: name, state, finished: plan.finished, total: plan.total });
  const progress = plan.total ? `<em>${esc(say(VIEW.CHIP_PROGRESS, { finished: plan.finished, total: plan.total }))}</em>` : '';
  return `<button class="pl-chip pl-${plan.lifecycle}" data-plan="${esc(plan.slug)}" aria-pressed="${on}" data-tip="${esc(title)}"><span class="pl-chip-name">${esc(name)}</span><span class="pl-state pl-${plan.lifecycle}">${esc(state)}</span>${progress}</button>`;
}

function mountPlanStrip(el: HTMLElement, onSelect: (slug: string) => void): PlanStrip {
  el.addEventListener('click', (ev) => {
    const chip = (ev.target as Element).closest('button[data-plan]');
    if (chip) onSelect(chip.getAttribute('data-plan') ?? '');
  });

  return {
    sync(plans, selected) {
      el.hidden = plans.length === 0;
      if (!plans.length) {
        el.textContent = '';
        return;
      }
      const focused = el.contains(document.activeElement) ? (document.activeElement as Element).getAttribute('data-plan') : null;
      el.innerHTML = `<span class="pr-label">${esc(say(VIEW.STRIP_LABEL))}</span><div class="pr-chips">${plans.map((plan) => chipHtml(plan, plan.slug === selected)).join('')}</div>`;
      if (focused) [...el.querySelectorAll<HTMLElement>('button[data-plan]')].find((chip) => chip.getAttribute('data-plan') === focused)?.focus();
    },
  };
}

export { mountPlanStrip };
export type { PlanStrip };
