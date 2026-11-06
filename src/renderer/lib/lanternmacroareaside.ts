import { esc } from './lanternctx';
import { plural } from './lanternmacro';
import type { GraphBlock, MacroGraph } from './lanternmacro';
import { joinWords, sentence } from './lanternmacromentions';

interface Nouns {
  sub: string;
  cards: string;
  group: string;
  inside: string;
  between: string;
}

const FLAT_NOUNS: Nouns = { sub: 'Macro view, one block per feature', cards: 'feature blocks', group: 'Features', inside: 'in blocks', between: 'between blocks' };
function nounsOf(graph: Pick<MacroGraph, 'level' | 'area'>): Nouns {
  if (graph.level === 'areas') return { sub: 'Macro view, one card per area', cards: 'areas', group: 'Areas', inside: 'in areas', between: 'between areas' };
  if (graph.level === 'area') return { ...FLAT_NOUNS, sub: `Macro view, inside ${graph.area?.name ?? 'an area'}`, cards: 'features' };
  return FLAT_NOUNS;
}

function membersSentence(block: GraphBlock) {
  return block.members?.length ? `<p class="lt-sentence">Features: ${joinWords(block.members.map(esc))}.</p>` : '';
}

function openButton(block: GraphBlock) {
  return block.opens ? `<button type="button" class="lt-open-area" data-macro-enter="${esc(block.key)}">Open ${esc(block.name)}</button>` : '';
}

function roleText(block: GraphBlock, fallback: string) {
  if (!block.members) return fallback;
  return `${block.unplaced ? 'not in an area yet' : 'area'} · ${block.caption ?? ''}`;
}

function stubDetailHtml(block: GraphBlock, areaName: string, colour: string) {
  const traffic = block.traffic;
  const flows = traffic ? `<p class="lt-sentence">Features of ${esc(areaName)} send ${plural(traffic.out, 'relation')} to it and take ${plural(traffic.in, 'relation')} from it.</p>` : '';
  return (
    `<section class="lt-detail" style="--c: ${colour}">` +
    '<button class="close" data-macro-go="" aria-label="Close details">×</button>' +
    `<div class="path"><span>${esc(block.name)}</span></div>` +
    `<span class="role">another area · ${esc(block.caption ?? '')}</span>` +
    flows +
    openButton(block) +
    '</section>'
  );
}

function areaHeadHtml(graph: MacroGraph) {
  const area = graph.area;
  if (graph.level !== 'area' || !area) return '';
  const partners = graph.blocks.filter((block) => block.kind === 'stub').map((block) => ({ key: block.key, name: block.name, count: (block.traffic?.out ?? 0) + (block.traffic?.in ?? 0) }));
  const systems = graph.systems.map((system) => ({ key: system.key, name: system.name, count: system.links.reduce((sum, link) => sum + link.count, 0) }));
  return (
    '<section class="lt-area-head" aria-label="This area">' +
    `<h2>${esc(area.name)}</h2>` +
    (area.purpose ? `<p class="lt-purpose">${esc(area.purpose)}</p>` : '') +
    sentence('Works with', partners) +
    sentence('Talks to the outside systems', systems) +
    '<button type="button" class="lt-open-area" data-macro-up>Back to the areas</button>' +
    '</section>'
  );
}

function areasNoteHtml(warning: string) {
  return warning ? `<p class="lt-areas-note" role="note">${esc(warning)}</p>` : '';
}

const AREAS_HINT_TEXT = 'This project can be grouped into areas. Running lantern-setup in Retag mode builds them.';

function areasHintHtml(hint: boolean) {
  return hint ? `<p class="lt-areas-hint" role="note">${esc(AREAS_HINT_TEXT)}</p>` : '';
}

export { AREAS_HINT_TEXT, areaHeadHtml, areasHintHtml, areasNoteHtml, membersSentence, nounsOf, openButton, roleText, stubDetailHtml };
