import type { LanternMap } from '../../main/lantern';
import { esc } from './lanternctx';
import { isTabbed } from './lanternscope';

function platformIds(data: LanternMap) {
  return ['', ...data.platforms.map((p) => p.id)];
}

function tabsHtml(data: LanternMap, current: string) {
  if (!isTabbed(data)) return '';
  const items = [{ id: '', label: 'All', kind: '', count: data.nodes.length }, ...data.platforms.map((p) => ({ id: p.id, label: p.label, kind: p.kind, count: p.count }))];
  const tabs = items
    .map((it) => {
      const on = it.id === current;
      const title = it.kind ? ` data-tip="${esc(it.kind)}"` : '';
      return `<button class="lt-plat" role="tab" data-plat="${esc(it.id)}" aria-selected="${on}" tabindex="${on ? 0 : -1}"${title}>${esc(it.label)} <em>${it.count}</em></button>`;
    })
    .join('');
  return `<div class="lt-tabs-strip" role="tablist" aria-label="Platforms"><b>Platform</b>${tabs}</div>`;
}

function neighbour(data: LanternMap, current: string, step: number) {
  const ids = platformIds(data);
  return ids[(ids.indexOf(current) + step + ids.length) % ids.length];
}

export { neighbour, tabsHtml };
