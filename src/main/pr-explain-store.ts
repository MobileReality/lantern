import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COMMIT_PATTERN, PR_EXPLAIN_MAX_PATH, PR_ID_PATTERN, SECTION_HEADINGS, isPrExplanationStale } from '../shared/pr-explain';
import type { PrExplainSections, PrExplanation } from '../shared/pr-explain';
import { writeFileAtomically } from './atomic-write';

const STORE_DIR = 'pr-explanations';
const STORE_VERSION = 1;
const SECTIONED_FORMAT = 2;
const MAX_ENTRIES = 300;
const MAX_BYTES = 400_000;
const PROJECT_KEY_CHARS = 20;

interface StoredExplanation {
  pr: string;
  path: string;
  head: string;
  text: string;
  at: number;
  format?: number;
  sections?: PrExplainSections;
}

interface StoreLimits {
  entries: number;
  bytes: number;
}

interface PrExplainStore {
  lookup(pr: string, path: string, head: string): PrExplanation | null;
  save(pr: string, path: string, head: string, text: string, sections?: PrExplainSections): PrExplanation;
}

const DEFAULT_LIMITS: StoreLimits = { entries: MAX_ENTRIES, bytes: MAX_BYTES };

function sizeOf(entry: StoredExplanation) {
  const sections = isSections(entry.sections) ? Object.values(entry.sections).reduce((sum, part) => sum + part.length, 0) : 0;
  return entry.text.length + sections + entry.path.length + entry.head.length + entry.pr.length;
}

function isStoredExplanation(value: unknown): value is StoredExplanation {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.pr === 'string' && PR_ID_PATTERN.test(e.pr) &&
    typeof e.path === 'string' && e.path.length > 0 && e.path.length <= PR_EXPLAIN_MAX_PATH &&
    typeof e.head === 'string' && COMMIT_PATTERN.test(e.head) &&
    typeof e.text === 'string' && e.text.length > 0 &&
    typeof e.at === 'number' && Number.isFinite(e.at)
  );
}

function isSections(value: unknown): value is PrExplainSections {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return SECTION_HEADINGS.every(([key]) => typeof s[key] === 'string');
}

function sectionsOf(entry: StoredExplanation) {
  return entry.format === SECTIONED_FORMAT && isSections(entry.sections) ? entry.sections : undefined;
}

function boundEntries(entries: StoredExplanation[], limits: StoreLimits) {
  const newestFirst = entries.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.at - a.entry.at || b.index - a.index);
  const kept: StoredExplanation[] = [];
  let bytes = 0;
  for (const { entry } of newestFirst) {
    if (kept.length >= limits.entries) break;
    const size = sizeOf(entry);
    if (kept.length > 0 && bytes + size > limits.bytes) break;
    kept.push(entry);
    bytes += size;
  }
  return kept;
}

function storeFileFor(userData: string, project: string) {
  const key = createHash('sha256').update(path.resolve(project)).digest('hex').slice(0, PROJECT_KEY_CHARS);
  return path.join(userData, STORE_DIR, `${key}.json`);
}

function readEntries(file: string): StoredExplanation[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; entries?: unknown };
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isStoredExplanation);
  } catch {
    return [];
  }
}

function writeEntries(file: string, entries: StoredExplanation[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomically(file, JSON.stringify({ version: STORE_VERSION, entries }));
}

function present(entry: StoredExplanation, head: string): PrExplanation {
  const sections = sectionsOf(entry);
  return { text: entry.text, ...(sections ? { sections } : {}), head: entry.head, at: entry.at, stale: isPrExplanationStale(entry.head, head) };
}

function createPrExplainStore(file: string, limits: StoreLimits = DEFAULT_LIMITS, now: () => number = Date.now): PrExplainStore {
  return {
    lookup(pr, filePath, head) {
      const found = readEntries(file).find((e) => e.pr === pr && e.path === filePath);
      return found ? present(found, head) : null;
    },
    save(pr, filePath, head, text, sections) {
      const others = readEntries(file).filter((e) => !(e.pr === pr && e.path === filePath));
      const entry: StoredExplanation = { pr, path: filePath, head, text, at: now(), ...(sections ? { format: SECTIONED_FORMAT, sections } : {}) };
      writeEntries(file, boundEntries([...others, entry], limits));
      return present(entry, head);
    },
  };
}

export { DEFAULT_LIMITS, boundEntries, createPrExplainStore, storeFileFor };
export type { PrExplainStore, StoreLimits, StoredExplanation };
