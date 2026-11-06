import { esc } from './lanternctx';
import { blockKey, plural } from './lanternmacro';
import type { GraphBlock, MacroGraph } from './lanternmacro';
import { foundationPartners, platformCarriers, platformReached } from './lanternmacrofoundation';
import type { Standing } from './lanternmacrofoundation';
import { joinWords, sentence } from './lanternmacromentions';
import type { Mention } from './lanternmacromentions';
import { platformName, platformOfFoundation } from './lanternmacronames';

const STANDINGS: readonly Standing[] = ['uses', 'used by', 'connects to'];
const LEADS: Readonly<Record<Standing, string>> = { uses: 'Uses', 'used by': 'Used by', 'connects to': 'Connects to' };
const CARRIERS_LEAD = 'Files here:';
const REACHED_LEAD = 'Uses, through relations:';

function partnerMentions(graph: MacroGraph, block: GraphBlock): Record<Standing, Mention[]> {
  const present = new Map(graph.blocks.map((candidate) => [candidate.id, candidate]));
  const grouped: Record<Standing, Mention[]> = { uses: [], 'used by': [], 'connects to': [] };
  for (const partner of foundationPartners(graph.foundationLinks ?? [], block.id)) {
    const other = present.get(partner.id);
    if (other) grouped[partner.standing].push({ key: other.key, name: other.name, count: partner.count });
  }
  return grouped;
}

function carrierMentions(graph: MacroGraph, block: GraphBlock): Mention[] {
  const platform = platformOfFoundation(block.id);
  if (platform === null) return [];
  return platformCarriers(graph.blocks, platform).map(({ block: carrier, files }) => ({ key: carrier.key, name: carrier.name, count: files, noun: 'file' }));
}

function reachedMentions(graph: MacroGraph, block: GraphBlock): Mention[] {
  const platform = platformOfFoundation(block.id);
  if (platform === null) return [];
  return platformReached(graph.blocks, platform).map(({ block: reached, relations }) => ({ key: reached.key, name: reached.name, count: relations }));
}

function foundationLinksHtml(graph: MacroGraph, block: GraphBlock) {
  const grouped = partnerMentions(graph, block);
  const carriers = carrierMentions(graph, block);
  const html = STANDINGS.map((standing) => sentence(LEADS[standing], grouped[standing])).join('') + sentence(CARRIERS_LEAD, carriers) + sentence(REACHED_LEAD, reachedMentions(graph, block));
  return { html, any: html !== '' };
}

function foundationOfBlock(graph: MacroGraph, block: GraphBlock, direction: 'sends' | 'takes'): Mention[] {
  const present = new Map(graph.blocks.map((candidate) => [candidate.id, candidate]));
  return (graph.foundationLinks ?? []).flatMap((link) => {
    const sends = direction === 'sends';
    if ((sends ? link.from : link.to) !== block.id) return [];
    const other = present.get(sends ? link.to : link.from);
    return other?.kind === 'core' ? [{ key: other.key, name: other.name, count: link.count }] : [];
  });
}

function platformsHtml(graph: MacroGraph, block: GraphBlock) {
  const platforms = block.platforms ?? [];
  if (!platforms.length || block.kind === 'core') return '';
  const present = new Set(graph.blocks.map((candidate) => candidate.key));
  const parts = platforms.map(({ platform, files }) => {
    const key = blockKey(`core:${platform}`);
    const name = present.has(key) ? `<button data-macro-go="${esc(key)}">${esc(platformName(platform))}</button>` : esc(platformName(platform));
    return `${name} (${plural(files, 'file')})`;
  });
  return `<p class="lt-sentence">Platforms: ${joinWords(parts)}.</p>`;
}

export { foundationLinksHtml, foundationOfBlock, platformsHtml };
