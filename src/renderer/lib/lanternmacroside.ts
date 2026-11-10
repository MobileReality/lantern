import type { LanternMap, LanternPrFile } from '../../main/lantern';
import { esc } from './lanternctx';
import { FOUNDATION_HEADING, FOUNDATION_KEY, SYSTEM_KEY, plural } from './lanternmacro';
import type { GraphBlock, GraphSystem, MacroGraph } from './lanternmacro';
import { OPEN_FILE_LABEL } from './lanternmacrocurrent';
import { foundationFocus } from './lanternmacrofoundation';
import { foundationLinksHtml, foundationOfBlock, platformsHtml } from './lanternmacrofoundationside';
import type { OpenFileBlock } from './lanternmacrocurrent';
import { areaHeadHtml, areasHintHtml, areasNoteHtml, membersSentence, nounsOf, openButton, roleText, stubDetailHtml } from './lanternmacroareaside';
import { legendHtml } from './lanternmacrolegendhtml';
import type { LegendWhen } from './lanternmacrolegend';
import { PR_SYSTEM_NOTE, SYSTEM_NOTE, systemUsesHtml } from './lanternmacrosystemside';
import { systemUses } from './lanternmacrosystems';
import { markCaption } from './lanternmacromarks';
import type { BlockMark, MacroPrView } from './lanternmacromarks';
import { joinWords, sentence } from './lanternmacromentions';
import type { Mention } from './lanternmacromentions';
import { blockName } from './lanternmacronames';
import { outsideCount } from './lanternmacropr';
import { restCounts } from './lanternmacrorest';
import { fileLabel } from './util';
import type { MacroFrame } from './lanternmacroview';
import { fileRow, reviewSequence } from './lanternprpanel';
import type { PrPanelContext } from './lanternprpanel';

interface MacroSidePr {
  view: MacroPrView;
  rows: PrPanelContext;
}

const FEATURE_COLOUR = 'var(--lt-l-domain)';
const FOUNDATION_COLOUR = 'var(--lt-l-support)';
const FOUNDATION_NOTE = 'Shared plumbing that several features rely on. It is not a feature itself.';

function entryCount(count: number) {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

function colourOf(block: GraphBlock) {
  return block.kind === 'core' ? FOUNDATION_COLOUR : FEATURE_COLOUR;
}

function blockChip(block: GraphBlock, selected: string | null, mark: BlockMark | undefined) {
  const count = mark ? `<em data-tip="${markCaption(mark)}">${mark.changed}/${block.files}</em>` : `<em>${block.files}</em>`;
  return `<button class="chip${mark ? ' wip' : ''}" style="--c: ${colourOf(block)}" data-macro-go="${esc(block.key)}" aria-pressed="${block.key === selected}" data-tip="${esc(block.purpose || block.name)}"><i></i>${esc(block.name)} ${count}</button>`;
}

function bandChip(blocks: GraphBlock[], selected: string | null) {
  const files = blocks.reduce((sum, block) => sum + block.files, 0);
  return `<button class="chip" style="--c: ${FOUNDATION_COLOUR}" data-macro-go="${FOUNDATION_KEY}" aria-pressed="${selected === FOUNDATION_KEY}" data-tip="All the entries of the ${FOUNDATION_HEADING.toLowerCase()} and the features that rely on them"><i></i>Whole band <em>${files}</em></button>`;
}

function chipGroup(title: string, blocks: GraphBlock[], selected: string | null, pr: MacroSidePr | null, whole = false) {
  const chips = blocks.map((block) => blockChip(block, selected, pr?.view.marks.blocks.get(block.key))).join('');
  return blocks.length ? `<h2>${title}</h2><div class="chips">${whole ? bandChip(blocks, selected) : ''}${chips}</div>` : '';
}

function changedFilesHtml(pr: MacroSidePr, blockId: string, mark: BlockMark) {
  const sequence = reviewSequence(pr.view.pr);
  const rowsOf = (files: readonly LanternPrFile[]) => `<ul class="pr-files pr-ordered">${files.map((file) => fileRow(pr.rows, file)).join('')}</ul>`;
  const heading = `<h2 class="pr-review lt-pr-changed"><span>Changed in this pull request</span><em>${markCaption(mark)}</em></h2>`;
  const features = pr.view.members.get(blockId);
  if (!features) return heading + rowsOf(pr.view.impact.blocks.get(blockId) ?? []);
  const groups = features.map((feature) => ({ feature, files: pr.view.impact.blocks.get(feature) ?? [] })).filter((group) => group.files.length);
  const firstStep = (files: readonly LanternPrFile[]) => sequence.findIndex((candidate) => candidate.path === files[0].path);
  groups.sort((a, b) => firstStep(a.files) - firstStep(b.files));
  return heading + groups.map((group) => `<h3 class="lt-pr-feature">${esc(blockName(group.feature))} <em>${group.files.length}</em></h3>${rowsOf(group.files)}`).join('');
}

function prSummaryHtml({ view }: MacroSidePr, graph: MacroGraph) {
  const { pr, impact } = view;
  const { other } = impact;
  const lit = view.marks.blocks.size;
  const parts = [
    other.unmapped.length ? `${other.unmapped.length} not in the map` : '',
    other.tests.length ? `${plural(other.tests.length, 'test file')}, not drawn here` : '',
    other.unplaced.length ? `${other.unplaced.length} in no block` : '',
    other.foundation.length ? `${other.foundation.length} in the ${FOUNDATION_HEADING.toLowerCase()}, which has no feature` : '',
  ].filter(Boolean);
  const note = parts.length ? `<p class="lt-pr-other" role="note"><b>Other files, ${outsideCount(other)}:</b> ${parts.join(' · ')}.</p>` : '';
  const systems = graph.systems.filter((system) => view.marks.systems.has(system.key));
  const touched = systems.length ? `<p class="lt-sentence">Outside systems it touches: ${joinWords(systems.map((system) => `<button data-macro-go="${esc(system.key)}">${esc(system.name)}</button>`))}. Click one to see it.</p>` : '';
  return (
    '<section class="lt-prsum" aria-label="Pull request on the Macro view">' +
    `<h2>Pull request #${esc(pr.id)}</h2><p class="lt-pr-title">${esc(pr.title)}</p>` +
    `<p class="lt-pr-lit">${impact.changed} of ${plural(pr.files.length, 'changed file')} sit in ${plural(lit, graph.level === 'areas' ? 'card' : 'block')}, lit on the graph. ${plural(impact.edges.size, 'link')} and ${plural(view.marks.systems.size, 'outside system')} carry a changed file.</p>` +
    touched +
    note +
    '</section>'
  );
}

function foundationSentence(lead: string, mentions: Mention[]) {
  const relations = mentions.reduce((sum, mention) => sum + mention.count, 0);
  return sentence(`${lead} (${plural(relations, 'relation')} in all):`, mentions);
}

function related(graph: MacroGraph, key: string, direction: 'sends' | 'takes', kind: GraphBlock['kind'] | null): Mention[] {
  const blocks = new Map(graph.blocks.map((block) => [block.key, block]));
  return graph.edges.flatMap((edge) => {
    const sends = direction === 'sends';
    if ((sends ? edge.fromKey : edge.toKey) !== key) return [];
    const other = blocks.get(sends ? edge.toKey : edge.fromKey);
    return other && (kind === null || other.kind === kind) ? [{ key: other.key, name: other.name, count: edge.count }] : [];
  });
}

function blockDetail(frame: MacroFrame, key: string, pr: MacroSidePr | null) {
  const shape = frame.shape;
  const block = shape?.graph.blocks.find((candidate) => candidate.key === key);
  if (!shape || !block) return '';
  const { graph } = shape;
  if (block.kind === 'stub') return stubDetailHtml(block, graph.area?.name ?? 'this area', FEATURE_COLOUR);
  const scope = block.kind === 'core' ? null : 'feature';
  const sends = related(graph, key, 'sends', scope);
  const takes = related(graph, key, 'takes', scope);
  const reliesOn = scope ? [...related(graph, key, 'sends', 'core'), ...foundationOfBlock(graph, block, 'sends')] : [];
  const reachedBy = scope ? [...related(graph, key, 'takes', 'core'), ...foundationOfBlock(graph, block, 'takes')] : [];
  const outside = graph.systems.flatMap((system) => system.links.filter((link) => link.blockKey === key).map((link) => ({ key: system.key, name: system.name, count: link.count })));
  const lead = block.kind === 'core' ? FOUNDATION_NOTE : block.purpose;
  const foundation = block.kind === 'core' ? foundationLinksHtml(graph, block) : { html: '', any: false };
  const none = foundation.any || sends.length + takes.length + reliesOn.length + reachedBy.length + outside.length ? '' : '<p class="none">No relations to other blocks.</p>';
  const mark = pr?.view.marks.blocks.get(key);
  const changed = pr && mark ? changedFilesHtml(pr, block.id, mark) : '';
  return (
    `<section class="lt-detail" style="--c: ${colourOf(block)}">` +
    '<button class="close" data-macro-go="" aria-label="Close details">×</button>' +
    `<div class="path"><span>${esc(block.name)}</span></div>` +
    `<span class="role">${roleText(block, `${block.kind === 'core' ? FOUNDATION_HEADING.toLowerCase() : 'feature'} · ${plural(block.files, 'file')}`)}</span>` +
    (lead ? `<p class="lt-purpose">${esc(lead)}</p>` : '') +
    membersSentence(block) +
    platformsHtml(graph, block) +
    foundation.html +
    sentence('Sends to', sends) +
    sentence('Takes from', takes) +
    foundationSentence(`Relies on the ${FOUNDATION_HEADING.toLowerCase()}`, reliesOn) +
    foundationSentence(`Is relied on by the ${FOUNDATION_HEADING.toLowerCase()}`, reachedBy) +
    sentence(outside.length === 1 ? 'Talks to the outside system' : 'Talks to the outside systems', outside) +
    none +
    openButton(block) +
    changed +
    '</section>'
  );
}

function bandDetail(frame: MacroFrame) {
  const graph = frame.shape?.graph;
  const entries = graph?.blocks.filter((block) => block.kind === 'core') ?? [];
  if (!graph || !entries.length) return '';
  const core = new Set(entries.map((entry) => entry.key));
  const perFeature = (toward: 'core' | 'feature') =>
    graph.blocks
      .filter((block) => block.kind === 'feature')
      .map((block) => ({ key: block.key, name: block.name, count: graph.edges.filter((edge) => (toward === 'core' ? edge.fromKey === block.key && core.has(edge.toKey) : edge.toKey === block.key && core.has(edge.fromKey))).reduce((sum, edge) => sum + edge.count, 0) }))
      .filter((mention) => mention.count > 0);
  const files = entries.reduce((sum, entry) => sum + entry.files, 0);
  return (
    `<section class="lt-detail" style="--c: ${FOUNDATION_COLOUR}">` +
    '<button class="close" data-macro-go="" aria-label="Close details">×</button>' +
    `<div class="path"><span>${FOUNDATION_HEADING}</span></div>` +
    `<span class="role">${FOUNDATION_HEADING.toLowerCase()} · ${entryCount(entries.length)} · ${plural(files, 'file')}</span>` +
    `<p class="lt-purpose">${esc(FOUNDATION_NOTE)}</p>` +
    sentence('Entries:', entries.map((entry) => ({ key: entry.key, name: entry.name, count: entry.files, noun: 'file' }))) +
    foundationSentence('Features that rely on it', perFeature('core')) +
    foundationSentence('Features it reaches into', perFeature('feature')) +
    '</section>'
  );
}

function systemDetail(frame: MacroFrame, key: string, pr: MacroSidePr | null) {
  const touchedByPr = !!pr?.view.marks.systems.has(key);
  const uses = frame.payload?.areas ? systemUses(frame.payload, key.slice(SYSTEM_KEY.length)) : null;
  if (uses) return systemUsesHtml(uses, touchedByPr);
  const system: GraphSystem | undefined = frame.shape?.graph.systems.find((candidate) => candidate.key === key);
  if (!system) return '';
  const users = system.links.map((link) => ({ key: link.blockKey, name: link.blockName, count: link.count }));
  const touched = touchedByPr ? `<p class="lt-sentence">${PR_SYSTEM_NOTE}</p>` : '';
  return `<section class="lt-detail" style="--c: var(--lt-l-system)"><button class="close" data-macro-go="" aria-label="Close details">×</button><div class="path"><span>${esc(system.name)}</span></div><span class="role">outside system</span><p class="lt-purpose">${SYSTEM_NOTE}</p>${sentence('Used by', users)}${touched}</section>`;
}

function legendHolds(frame: MacroFrame, graph: MacroGraph, selected: string | null, pr: MacroSidePr | null, openFile: OpenFileBlock | null) {
  const holds = new Set<LegendWhen>();
  const flat = graph.level === 'flat';
  const picksSystem = selected !== null && selected.startsWith(SYSTEM_KEY);
  const focus = !flat && frame.payload?.areas ? foundationFocus(graph, frame.payload.areas, selected) : null;
  const add = (when: LegendWhen, on: boolean) => on && holds.add(when);
  add('selection', selected !== null);
  add('block', selected !== null && !picksSystem);
  add('links', !flat && graph.blocks.some((block) => block.key === selected && block.kind === 'feature'));
  add('uses', !!focus && focus.usesAreas.size + focus.usesFeatures.size > 0);
  add('pr', !!pr);
  add('reading', !!openFile);
  add('flow', !!pr?.rows.flowStep);
  add('pending', !flat && !!frame.payload?.areas?.level0.toAssign);
  add('systems', graph.systems.length > 0 && (!flat || selected !== null || !!pr || !!openFile));
  add('system', !flat && picksSystem);
  return holds;
}

function openFileNote(openFile: OpenFileBlock | null) {
  if (!openFile || openFile.blockKey) return '';
  const { area } = openFile;
  const where = area ? `is in another area, ${esc(area.name)}.` : 'is not in any block.';
  const enter = area ? `<button type="button" class="lt-open-area" data-macro-enter="${esc(area.key)}">Open ${esc(area.name)}</button>` : '';
  return `<p class="lt-pr-other lt-open-note" role="note"><b>${OPEN_FILE_LABEL}:</b> ${esc(fileLabel(openFile.path))} ${where}</p>${enter}`;
}

function detailOf(frame: MacroFrame, selected: string | null, pr: MacroSidePr | null) {
  if (!selected) return '';
  if (selected === FOUNDATION_KEY) return bandDetail(frame);
  return selected.startsWith(SYSTEM_KEY) ? systemDetail(frame, selected, pr) : blockDetail(frame, selected, pr);
}

function statsHtml(frame: MacroFrame, graph: MacroGraph) {
  const counts = frame.rest ? restCounts(frame.rest) : null;
  const pending = graph.blocks.find((block) => block.unplaced);
  const strong = frame.rest ? frame.rest.arcs.filter((arc) => arc.edge.main && arc.edge.strong).length : 0;
  return (
    `<div class="stats"><div><b>${counts?.featureCards ?? 0}</b><span>${nounsOf(graph).cards}</span></div>` +
    `<div><b>${counts?.linksAtRest ?? 0}</b><span>main links, of ${counts?.linksTotal ?? 0}</span></div>` +
    `<div class="wip"><b>${strong}</b><span>strong</span></div>` +
    (pending ? `<div class="unm"><b>${pending.members?.length ?? 0}</b><span>to assign</span></div>` : '') +
    `<div class="unm"><b>${graph.systems.length}</b><span>outside systems</span></div></div>`
  );
}

function macroSideHtml(data: LanternMap, frame: MacroFrame, selected: string | null, pr: MacroSidePr | null = null, openFile: OpenFileBlock | null = null) {
  const headFor = (sub: string) => `<div class="lt-brand"><h1 class="lt-proj" data-tip="${esc(data.project)}">${esc(data.project)}</h1><p class="sub">${esc(sub)}</p></div>`;
  const shape = frame.shape;
  if (!shape) return `${headFor(nounsOf({ level: 'flat' }).sub)}<div class="coverage" role="status">${esc(frame.loading || !frame.error ? 'Loading the macro view…' : `The macro view could not be loaded: ${frame.error}`)}</div>`;
  const { graph } = shape;
  const nouns = nounsOf(graph);
  const band = graph.blocks.filter((block) => block.kind === 'core');
  return (
    headFor(nouns.sub) +
    statsHtml(frame, graph) +
    `<div class="coverage">${plural(graph.files, 'file')} ${nouns.inside}, ${plural(graph.tests, 'test file')} left out · ${plural(graph.relations, 'relation')} ${nouns.between} · ${entryCount(band.length)} in the ${FOUNDATION_HEADING.toLowerCase()}</div>` +
    areasNoteHtml(frame.warning) +
    areasHintHtml(frame.hint) +
    (pr ? prSummaryHtml(pr, graph) : '') +
    openFileNote(openFile) +
    areaHeadHtml(graph) +
    detailOf(frame, selected, pr) +
    chipGroup(nouns.group, graph.blocks.filter((block) => block.kind === 'feature'), selected, pr) +
    chipGroup('Other areas', graph.blocks.filter((block) => block.kind === 'stub'), selected, pr) +
    chipGroup(FOUNDATION_HEADING, band, selected, pr, true) +
    legendHtml(graph.level === 'flat' ? 'flat' : 'areas', legendHolds(frame, graph, selected, pr, openFile), frame.minStrongEdge)
  );
}

export { macroSideHtml };
export type { MacroSidePr };
