import type { LanternMap, LanternSection } from '../../../main/lantern';
import { esc } from '../lanternctx';
import { platformLabel } from '../lanternscope';
import { dbRenderer } from './db';
import { factsRenderer } from './facts';
import { rbacRenderer } from './rbac';
import { statesRenderer } from './states';
import { fieldText } from './common';
import type { Renderer, SectionCtx } from './common';

const RENDERERS: { [T in LanternSection['type']]: Renderer<Extract<LanternSection, { type: T }>> } = {
  rbac: rbacRenderer,
  states: statesRenderer,
  db: dbRenderer,
  facts: factsRenderer,
};

function rendererOf(sec: LanternSection) {
  return RENDERERS[sec.type] as Renderer<LanternSection>;
}

function sectionsIn(data: LanternMap, platform: string) {
  return data.sections.filter((s) => !platform || !s.platform || s.platform === platform);
}

function countOf(sec: LanternSection) {
  return rendererOf(sec).count(sec);
}

function barHtml(sections: LanternSection[], open: string | null) {
  if (!sections.length) return '';
  const buttons = sections
    .map((s) => {
      const r = rendererOf(s);
      const on = s.id === open;
      const tip = `${s.title ?? r.label} · ${countOf(s)} ${r.noun}`;
      return `<button class="lt-sec" data-section="${esc(s.id)}" aria-pressed="${on}" data-tip="${esc(tip)}">${esc(r.label)} <em>${countOf(s)}</em></button>`;
    })
    .join('');
  return `<div class="lt-secbar" role="toolbar" aria-label="Project sections"><b>Sections</b>${buttons}</div>`;
}

function overlayHtml(data: LanternMap, sec: LanternSection, mapped: Set<string>, canOpenCode = false) {
  const r = rendererOf(sec);
  const ctx: SectionCtx = { data, sec, mapped, canOpenCode };
  const title = sec.title ? fieldText(ctx, 'title', sec.title) : esc(r.label);
  const scope = sec.platform ? `<span class="sx-badge">${esc(platformLabel(data, sec.platform) || sec.platform)}</span>` : '';
  const intro = sec.intro ? `<p class="sx-intro">${fieldText(ctx, 'intro', sec.intro)}</p>` : '';
  return (
    `<header class="sx-head"><span class="sx-kind">${esc(r.label)}</span><h2>${title}</h2>${scope}<span class="sx-count">${countOf(sec)} ${r.noun}</span>` +
    '<button class="sx-close" data-close="1" aria-label="Close section" data-tip="Close (Esc)">×</button></header>' +
    `<div class="sx-body">${intro}${r.body(ctx, sec)}</div>`
  );
}

export { barHtml, overlayHtml, sectionsIn };
