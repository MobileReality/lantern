import { INTENT_IDS, copyTexts } from '../../../shared/lang/fix-requests';
import type { CopyTexts, IntentId } from '../../../shared/lang/fix-requests';
import { PER_COMMENT, intentOf } from './intent';
import type { CopyChoice } from './intent';
import { hasRange } from './model';
import type { FixItem } from './model';

interface FixPrInfo {
  id: string;
  title: string;
  branch: string;
}

interface FormatOptions {
  order?: readonly string[];
  choice?: CopyChoice;
  texts?: CopyTexts;
}

const MIN_FENCE = 3;

function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function headerOf(pr: FixPrInfo, texts: CopyTexts) {
  const title = oneLine(pr.title);
  const branch = oneLine(pr.branch);
  const named = title ? `PR #${pr.id}: ${title}` : `PR #${pr.id}`;
  return [`${texts.header} ${branch ? `${named} (${branch})` : named}`, texts.scope].join('\n');
}

function fenceFor(code: string) {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  return '`'.repeat(Math.max(MIN_FENCE, longest + 1));
}

function locationOf(item: FixItem) {
  return hasRange(item) ? `${item.path}:${item.start}-${item.end}` : item.path;
}

function sortFixItems(items: readonly FixItem[], order: readonly string[]) {
  const rank = new Map(order.map((path, index) => [path, index]));
  const place = (item: FixItem) => rank.get(item.path) ?? order.length;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => place(a.item) - place(b.item) || a.item.path.localeCompare(b.item.path) || (a.item.start ?? 0) - (b.item.start ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}

function formatItem(item: FixItem, intent: IntentId, texts: CopyTexts) {
  const lines = [locationOf(item)];
  if (hasRange(item) && item.code !== undefined) {
    const code = item.code.replace(/\s+$/, '');
    const fence = fenceFor(code);
    lines.push(fence, code, fence);
  }
  const comment = item.comment.trim();
  if (comment) lines.push(`Comment: ${comment}`);
  const { label, instruction } = texts.intents[intent];
  lines.push(`${texts.intentWord}: ${label}. ${instruction}`);
  return lines.join('\n');
}

function preambleOf(present: ReadonlySet<IntentId>, texts: CopyTexts) {
  if (present.size < 2) return null;
  const bullets = INTENT_IDS.filter((id) => present.has(id)).map((id) => `- ${texts.intents[id].label}: ${texts.intents[id].instruction}`);
  return [texts.mixed, ...bullets].join('\n');
}

function formatFixRequests(pr: FixPrInfo, items: readonly FixItem[], options: FormatOptions = {}) {
  const { order = [], choice = PER_COMMENT, texts = copyTexts() } = options;
  const sorted = sortFixItems(items, order).map((item) => ({ item, intent: intentOf(item, choice) }));
  const preamble = preambleOf(new Set(sorted.map((each) => each.intent)), texts);
  const blocks = sorted.map(({ item, intent }) => formatItem(item, intent, texts));
  return [headerOf(pr, texts), ...(preamble ? [preamble] : []), ...blocks].join('\n\n');
}

export { formatFixRequests, sortFixItems };
export type { FixPrInfo, FormatOptions };
