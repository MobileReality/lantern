import { hasControlCharacter } from '../shared/control-characters';
import type { LanternPrDescription, LanternPrDescriptionSection } from './lantern-types';

const DESCRIBE_SECTIONS: readonly LanternPrDescriptionSection[] = ['what', 'before', 'after', 'verified'];
const DESCRIBE_TEXT_MAX = 400;
const DESCRIBE_MAX_LINES = 8;
const DESCRIBE_LINE = /^#describe(?:[ \t]+(.*?))?[ \t]*$/;
const COMMENT = /<!--.*?(?:-->|$)/g;
const COST_MARKER = /delegate:cost/i;
const TABLE_ROW = /^\|/;

function describeClean(text: string) {
  const stripped = text.replace(COMMENT, '').replace(/-->/g, '').trim();
  return COST_MARKER.test(stripped) || TABLE_ROW.test(stripped) ? '' : stripped;
}

function matchDescribeLine(line: string): string | null {
  const m = DESCRIBE_LINE.exec(line);
  return m ? (m[1] ?? '') : null;
}

function parseDescribeLines(raws: string[]): LanternPrDescription | null {
  const description: LanternPrDescription = {};
  for (const raw of raws) {
    const cut = raw.search(/\s/);
    const section = cut === -1 ? raw : raw.slice(0, cut);
    const text = cut === -1 ? '' : raw.slice(cut).trim();
    if (!(DESCRIBE_SECTIONS as readonly string[]).includes(section)) continue;
    if (!text || hasControlCharacter(text) || [...text].length > DESCRIBE_TEXT_MAX) continue;
    const clean = describeClean(text);
    const kept = description[section as LanternPrDescriptionSection] ?? [];
    if (!clean || kept.length >= DESCRIBE_MAX_LINES) continue;
    description[section as LanternPrDescriptionSection] = [...kept, clean];
  }
  return Object.keys(description).length > 0 ? description : null;
}

export { DESCRIBE_SECTIONS, describeClean, matchDescribeLine, parseDescribeLines };
