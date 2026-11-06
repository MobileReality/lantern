import type { Arrow, LanternMap, LanternNode } from '../../main/lantern';
import type { Filters } from './lanternlayout';
import type { Profile } from './lanternprofile';
import type { DenseColumn } from './lanternrelview';
import type { Scope } from './lanternscope';

const KIND: Record<Arrow, string> = { '>': 'send', '<': 'take', '=': 'both', '@': 'ref' };
const FLIP: Record<Arrow, Arrow> = { '>': '<', '<': '>', '=': '=', '@': '@' };
const KIND_TEXT: Record<Arrow, string> = { '>': 'sends data into', '<': 'takes data from', '=': 'both ways', '@': 'refers to' };
const GLYPH: Record<Arrow, string> = { '>': '→', '<': '←', '=': '⇄', '@': '⇢' };
const ARROWS: Arrow[] = ['>', '<', '=', '@'];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function breakable(path: string) {
  return esc(path).replace(/\//g, '/<wbr>');
}

interface SideContext {
  uid: string;
  data: LanternMap;
  byPath: Map<string, LanternNode>;
  incoming: Map<string, LanternMap['relations']>;
  filters: Filters;
  selected: string | null;
  showUnmapped: boolean;
  shown: { nodes: number; edges: number };
  scope: Scope;
  profile: Profile;
  canOpenCode: boolean;
  relationView: boolean;
  canRelate: boolean;
  dense: DenseColumn | null;
  locked: boolean;
  inspected: string | null;
  lockNote: string;
  canMoveLock: boolean;
}

const fallbackSets = new WeakMap<LanternMap, Set<string>>();

function fallbackKeys(data: LanternMap) {
  let s = fallbackSets.get(data);
  if (!s) {
    s = new Set(data.language.fallbackKeys);
    fallbackSets.set(data, s);
  }
  return s;
}

function textHtml(data: LanternMap, key: string, text: string) {
  if (!fallbackKeys(data).has(key)) return esc(text);
  const lang = data.language.primary;
  return `<span class="fb" data-tip="Not translated yet; shown in ${esc(lang)}">${esc(text)}<sup>${esc(lang)}</sup></span>`;
}

function codeButton(path: string, symbol: string | null = '', title = 'Open code') {
  symbol = symbol ?? '';
  const label = symbol ? `${path}#${symbol}` : path;
  return `<button class="code-open" data-code="${esc(path)}" data-symbol="${esc(symbol)}" data-tip="${esc(title)}" aria-label="${esc(title === 'Open code' ? `Open code of ${label}` : `${title}: ${label}`)}">&lt;/&gt;</button>`;
}

export { ARROWS, codeButton, FLIP, GLYPH, KIND, KIND_TEXT, breakable, esc, textHtml };
export type { SideContext };
