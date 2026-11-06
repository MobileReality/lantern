import { isIntentId } from '../../../shared/lang/fix-requests';
import type { IntentId } from '../../../shared/lang/fix-requests';

interface FixItem {
  id: string;
  path: string;
  start?: number;
  end?: number;
  code?: string;
  preset?: string;
  intent?: IntentId;
  comment: string;
}

type FixDraft = Omit<FixItem, 'id'>;
type FixPatch = Partial<Omit<FixItem, 'id'>>;

function hasRange(item: Pick<FixItem, 'start' | 'end'>): item is { start: number; end: number } {
  return item.start !== undefined && item.end !== undefined;
}

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function normalizeRange(start: number, end: number) {
  return start <= end ? { start, end } : { start: end, end: start };
}

function parseItem(raw: unknown): FixItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || !value.id || typeof value.path !== 'string' || !value.path || typeof value.comment !== 'string') return null;
  const item: FixItem = { id: value.id, path: value.path, comment: value.comment };
  if (isLine(value.start) && isLine(value.end)) Object.assign(item, normalizeRange(value.start, value.end));
  if (typeof value.code === 'string' && hasRange(item)) item.code = value.code;
  if (typeof value.preset === 'string' && value.preset) item.preset = value.preset;
  if (isIntentId(value.intent)) item.intent = value.intent;
  return item;
}

function parseItems(raw: string | null): FixItem[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const items: FixItem[] = [];
    for (const each of value) {
      const item = parseItem(each);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    return items;
  } catch {
    return [];
  }
}

export { hasRange, normalizeRange, parseItems };
export type { FixDraft, FixItem, FixPatch };
