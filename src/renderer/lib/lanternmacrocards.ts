import { wrapPurpose } from './lanternmacronames';
import type { GraphBlock, MacroGraph } from './lanternmacro';

const BLOCK_CHAR_W = 7.8;
const BLOCK_MIN_W = 150;
const BLOCK_MAX_W = 320;
const PURPOSE_W = 300;
const BLOCK_H = 44;
const FOUNDATION_H = 36;
const STUB_H = 40;
const STUB_MIN_W = 130;
const AREA_PURPOSE_LINES = 3;
const CARD_PAD = 7;
const NAME_H = 16;
const CAPTION_H = 12;
const TEXT_GAP = 4;
const PURPOSE_LINE_H = 12;
const PURPOSE_CHAR_W = 6;
const TEXT_INSET = 14;
const TEXT_MARGIN = 10;

function namedWidth(blocks: readonly GraphBlock[]) {
  const longest = blocks.reduce((max, block) => Math.max(max, block.name.length), 0);
  return Math.round(longest * BLOCK_CHAR_W + 36);
}

function cardWidth(graph: MacroGraph) {
  const features = graph.blocks.filter((block) => block.kind === 'feature');
  const named = namedWidth(features);
  const wanted = features.some((block) => block.purpose) ? Math.max(named, PURPOSE_W) : named;
  return Math.max(BLOCK_MIN_W, Math.min(BLOCK_MAX_W, wanted));
}

function bandWidth(graph: MacroGraph) {
  return Math.max(BLOCK_MIN_W, Math.min(BLOCK_MAX_W, namedWidth(graph.blocks.filter((block) => block.kind === 'core'))));
}

function stubWidth(graph: MacroGraph) {
  const longest = graph.blocks.filter((block) => block.kind === 'stub').reduce((max, block) => Math.max(max, block.name.length), 0);
  return Math.max(STUB_MIN_W, Math.min(BLOCK_MAX_W, Math.round(longest * BLOCK_CHAR_W + 36)));
}

function purposeLines(block: GraphBlock, width: number) {
  const room = Math.floor((width - TEXT_INSET - TEXT_MARGIN) / PURPOSE_CHAR_W);
  return block.purpose ? wrapPurpose(block.purpose, room, block.members ? AREA_PURPOSE_LINES : undefined) : [];
}

function cardHeight(block: GraphBlock, lines: readonly string[]) {
  if (block.kind === 'core') return FOUNDATION_H;
  if (block.kind === 'stub') return STUB_H;
  const text = NAME_H + TEXT_GAP + CAPTION_H + (lines.length ? TEXT_GAP + lines.length * PURPOSE_LINE_H : 0);
  return Math.max(BLOCK_H, Math.ceil(text + 2 * CARD_PAD));
}

export { PURPOSE_LINE_H, bandWidth, cardHeight, cardWidth, purposeLines, stubWidth };
