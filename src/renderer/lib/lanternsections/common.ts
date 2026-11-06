import type { LanternCite, LanternMap, LanternSection } from '../../../main/lantern';
import { codeButton, esc, textHtml } from '../lanternctx';

interface SectionCtx {
  data: LanternMap;
  sec: LanternSection;
  mapped: Set<string>;
  canOpenCode?: boolean;
}

interface Renderer<S extends LanternSection> {
  label: string;
  noun: string;
  count(sec: S): number;
  body(ctx: SectionCtx, sec: S): string;
}

function baseOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function citeLabel(c: LanternCite) {
  return c.symbol ? `${c.path}#${c.symbol}` : c.path;
}

function isLinked(ctx: SectionCtx, c: LanternCite) {
  return c.mapped && ctx.mapped.has(c.path);
}

function citeHtml(ctx: SectionCtx, c: LanternCite) {
  const name = `${esc(baseOf(c.path))}${c.symbol ? `<wbr><span>#${esc(c.symbol)}</span>` : ''}`;
  if (isLinked(ctx, c)) return `<button class="sx-cite" data-cite="${esc(c.path)}" data-tip="Select ${esc(citeLabel(c))} in the graph">${name}</button>${ctx.canOpenCode ? codeButton(c.path, c.symbol) : ''}`;
  return `<span class="sx-cite unmapped" data-tip="${esc(citeLabel(c))} is not a mapped file">${name}</span>`;
}

function citesHtml(ctx: SectionCtx, cites: LanternCite[]) {
  return cites.length ? `<span class="sx-cites">${cites.map((c) => citeHtml(ctx, c)).join('')}</span>` : '';
}

function fieldText(ctx: SectionCtx, key: string, text: string) {
  return textHtml(ctx.data, `section ${ctx.sec.id} ${key}`, text);
}

function noteHtml(ctx: SectionCtx, key: string, text: string, tag = 'span') {
  return text ? `<${tag} class="sx-note">${fieldText(ctx, key, text)}</${tag}>` : '';
}

export { baseOf, citeHtml, citeLabel, citesHtml, fieldText, isLinked, noteHtml };
export type { Renderer, SectionCtx };
