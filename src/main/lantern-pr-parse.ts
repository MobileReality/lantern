import { PLAN_REF } from '../../skills/lantern-plan/scripts/plan-format.mjs';
import { hasControlCharacter } from '../shared/control-characters';
import { REASON_MAX_CHARS } from '../shared/reason';
import { matchDescribeLine, parseDescribeLines } from './lantern-describe-parse';
import { matchFlowLine, parseFlowLines } from './lantern-flow-parse';
import type { FlowLine } from './lantern-flow-parse';
import { decodePath } from './lantern-parse';
import type { LanternFlowStory, LanternPrDescription, LanternPrFileKind, LanternPrPlanRef } from './lantern-types';

const PR_FORMAT_HEADER = 'lantern-pr 1';
const PR_DIR = '.lantern/prs';
const BRANCH_FORMAT_HEADER = 'lantern-branch 1';
const BRANCH_DIR = '.lantern/local';
const BRANCH_EXT = '.branch';
const REQUIRED = ['title', 'url', 'branch', 'base', 'opened', 'head'] as const;
const BRANCH_REQUIRED = ['branch', 'base', 'opened', 'head'] as const;
const ID_LINE = /^#[ \t]+(\d+)[ \t]*$/;
const KEY_LINE = /^#([a-z][a-z-]*)(?:[ \t]+(.*?))?[ \t]*$/;
const FILE_LINE = /^([+~-])[ \t]+(\S+)[ \t]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\S*)?$/;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ORDER_LINE = /^#order[ \t]+(\S+)[ \t]*$/;
const REASON_LINE = /^#(?:reason|why)[ \t]+(\S+)[ \t]+(.*?)[ \t]*$/;
const KINDS: Record<string, LanternPrFileKind> = { '+': 'added', '~': 'modified', '-': 'removed' };

interface ParsedPrFile {
  path: string;
  kind: LanternPrFileKind;
  reason?: string;
}

interface ParsedPr {
  id: string;
  title: string;
  url: string;
  branch: string;
  base: string;
  opened: string;
  head: string;
  summary: string | null;
  description?: LanternPrDescription;
  plans?: LanternPrPlanRef[];
  files: ParsedPrFile[];
  ordered?: boolean;
  flow?: LanternFlowStory[];
  flowError?: string;
}

type PrParseResult = { pr: ParsedPr; error: null } | { pr: null; error: string };

interface RecordSpec {
  header: string;
  required: readonly string[];
  hasId: boolean;
  expectedId(fileName: string): string | null;
}

const PR_SPEC: RecordSpec = { header: PR_FORMAT_HEADER, required: REQUIRED, hasId: true, expectedId: (fileName) => /^(\d+)\.pr$/.exec(fileName)?.[1] ?? null };
const BRANCH_SPEC: RecordSpec = { header: BRANCH_FORMAT_HEADER, required: BRANCH_REQUIRED, hasId: false, expectedId: () => '' };

function branchFileName(branch: string) {
  return `${branch.replace(/\//g, '__').replace(/[^\w.-]+/g, '_')}${BRANCH_EXT}`;
}

function isSafePath(rel: string) {
  return !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.split('/').some((seg) => seg === '..' || seg === '.' || seg === '');
}

function fail(error: string): PrParseResult {
  return { pr: null, error };
}

function parseRecord(text: string, fileName: string, spec: RecordSpec): PrParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trimEnd() !== spec.header) return fail(`first line must be "${spec.header}"`);
  const expectedId = spec.expectedId(fileName);
  if (expectedId === null) return fail('file name must be <id>.pr with a numeric id');
  const keys = new Map<string, string>();
  const files: ParsedPrFile[] = [];
  const seen = new Set<string>();
  const reasons = new Map<string, string>();
  const order: string[] = [];
  const flowLines: FlowLine[] = [];
  const describeLines: string[] = [];
  const plans: LanternPrPlanRef[] = [];
  let id: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const at = `line ${i + 1}`;
    if (line.startsWith('#')) {
      if (spec.hasId && id === null) {
        const m = ID_LINE.exec(line);
        if (!m) return fail(`${at}: the first # line must be the id ("# ${expectedId}")`);
        id = m[1];
        continue;
      }
      const pos = ORDER_LINE.exec(line);
      if (pos) {
        const target = decodePath(pos[1]);
        if (!order.includes(target)) order.push(target);
        continue;
      }
      const match = REASON_LINE.exec(line);
      if (match) {
        const reason = match[2];
        const target = decodePath(match[1]);
        if (reason && !hasControlCharacter(reason) && [...reason].length <= REASON_MAX_CHARS && !reasons.has(target)) reasons.set(target, reason);
        continue;
      }
      const planRef = PLAN_REF.exec(line);
      if (planRef) {
        if (!plans.some((p) => p.slug === planRef[1] && p.item === planRef[2])) plans.push({ slug: planRef[1], item: planRef[2] });
        continue;
      }
      const describeRaw = matchDescribeLine(line);
      if (describeRaw !== null) {
        describeLines.push(describeRaw);
        continue;
      }
      const flowLine = matchFlowLine(line, at);
      if (flowLine) {
        flowLines.push(flowLine);
        continue;
      }
      const m = KEY_LINE.exec(line);
      if (!m) continue;
      const [, key, value = ''] = m;
      if (!spec.required.includes(key) && key !== 'summary') continue;
      if (keys.has(key)) return fail(`${at}: duplicate #${key}`);
      keys.set(key, value);
      continue;
    }
    const f = FILE_LINE.exec(line);
    if (!f) return fail(`${at}: not a file line ("+ path", "~ path" or "- path")`);
    const rel = decodePath(f[2]);
    if (!isSafePath(rel)) return fail(`${at}: unsafe path ${f[2]}`);
    if (seen.has(rel)) return fail(`${at}: ${rel} listed twice`);
    seen.add(rel);
    files.push({ kind: KINDS[f[1]], path: rel });
  }
  if (spec.hasId && id === null) return fail('missing the id line ("# <id>")');
  if (spec.hasId && id !== expectedId) return fail(`id ${id} does not match the file name ${fileName}`);
  for (const key of spec.required) if (!keys.get(key)) return fail(`missing #${key}`);
  if (!ISO_DATE.test(keys.get('opened')!)) return fail('#opened must be an ISO date (YYYY-MM-DD)');
  if (!FULL_SHA.test(keys.get('head')!)) return fail('#head must be a full commit sha');
  const decorated = files.map((f) => (reasons.has(f.path) ? { ...f, reason: reasons.get(f.path) } : f));
  const rank = order.filter((p) => seen.has(p));
  const first = rank.flatMap((p) => decorated.filter((f) => f.path === p));
  const rest = decorated.filter((f) => !rank.includes(f.path));
  const flow = parseFlowLines(flowLines, seen);
  const description = parseDescribeLines(describeLines);
  return {
    pr: {
      id: id ?? '',
      title: keys.get('title') ?? '',
      url: keys.get('url') ?? '',
      branch: keys.get('branch')!,
      base: keys.get('base')!,
      opened: keys.get('opened')!,
      head: keys.get('head')!,
      summary: keys.get('summary') || null,
      ...(description ? { description } : {}),
      ...(plans.length > 0 ? { plans } : {}),
      files: [...first, ...rest],
      ...(rank.length > 0 ? { ordered: true } : {}),
      ...(flow.stories.length > 0 ? { flow: flow.stories } : {}),
      ...(flow.error ? { flowError: flow.error } : {}),
    },
    error: null,
  };
}

function parsePrRecord(text: string, fileName: string): PrParseResult {
  return parseRecord(text, fileName, PR_SPEC);
}

function parseBranchRecord(text: string, fileName: string): PrParseResult {
  return parseRecord(text, fileName, BRANCH_SPEC);
}

export { BRANCH_DIR, BRANCH_FORMAT_HEADER, PR_DIR, PR_FORMAT_HEADER, branchFileName, parseBranchRecord, parsePrRecord };
export type { ParsedPr, ParsedPrFile, PrParseResult };
